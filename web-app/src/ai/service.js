import { GoogleGenerativeAI } from '@google/generative-ai';

let genAI = null;
let model = null;
let apiKey = null;
let chatSession = null;

const SYSTEM_PROMPT = `Anda adalah asisten teknisi perbaikan HP profesional dengan pengalaman 15+ tahun.
Anda memiliki pengetahuan mendalam tentang:
- Arsitektur motherboard HP dan komponennya
- Analisis fault dan troubleshooting sistematis
- Pengukuran dengan multimeter, oscilloscope, dan PSU
- Perilaku komponen elektronika dan failure modes
- Safety procedures dalam perbaikan elektronik

Filosofi Anda:
- Analisis berdasarkan data, bukan asumsi
- Setiap pengukuran memiliki konsekuensi
- Risk assessment sebelum bertindak
- Dokumentasi temuan dengan presisi

Selalu jawab dalam Bahasa Indonesia yang baik dan profesional.`;

export function initAI(key) {
    if (!key || key.trim() === '') {
        return { success: false, error: 'API key tidak boleh kosong' };
    }
    
    try {
        apiKey = key.trim();
        genAI = new GoogleGenerativeAI(apiKey);
        model = genAI.getGenerativeModel({ 
            model: 'gemini-1.5-flash',
            systemInstruction: SYSTEM_PROMPT
        });
        
        chatSession = model.startChat({
            history: [],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048,
            }
        });
        
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export function isConfigured() {
    return model !== null && chatSession !== null;
}

export async function chat(prompt, options = {}) {
    if (!isConfigured()) {
        return { error: 'API Key belum diatur. Silakan masukkan API key di settings.' };
    }

    const { includeContext = true, context = null } = options;
    
    let fullPrompt = prompt;
    if (includeContext && context) {
        fullPrompt = `Context analisis perangkat:
- Distress: ${(context.distress * 100).toFixed(1)}%
- Rail voltages: ${JSON.stringify(context.voltages || {})}
- Thermal: ${JSON.stringify(context.thermals || {})}
- Diagnostic: ${context.diagnostic || 'Tidak ada'}

Pertanyaan: ${prompt}`;
    }

    try {
        const result = await chatSession.sendMessage(fullPrompt);
        const response = result.response;
        return { text: response.text() };
    } catch (e) {
        return { error: formatError(e) };
    }
}

export async function analyzePCB(componentData, measurementData = {}) {
    if (!isConfigured()) {
        return { error: 'API Key belum diatur.' };
    }

    const prompt = `
## ANALISIS PCB OTOMATIS

### Data Komponen:
${JSON.stringify(componentData, null, 2)}

### Data Pengukuran Saat Ini:
${JSON.stringify(measurementData, null, 2)}

### Instruksi Analisis:
Sebagai teknisi profesional, lakukan:

1. **identifikasi Komponen**: Identifikasi komponen yang relevan dan fungsinya
2. **Analisis Fault**: Jika ada data pengukuran, analisis apakah ada indikasi fault
3. **Risk Assessment**: Evaluasi risiko jika继续 mengukur
4. **Saran Pengukuran**: Rekomendasikan pengukuran selanjutnya jika diperlukan

Format respons dengan struktur berikut:
### Temuan:
[deskripsi temuan]

### Analisis:
[analisis teknis]

### Rekomendasi:
[aksi yang disarankan dengan risk level]
    `;

    try {
        const result = await model.generateContent(prompt);
        return { text: result.response.text() };
    } catch (e) {
        return { error: formatError(e) };
    }
}

export async function analyzeCircuit(railData, componentId) {
    if (!isConfigured()) {
        return { error: 'API Key belum diatur.' };
    }

    const prompt = `
## ANALISIS SISTEM PWR

### Rail Data:
${JSON.stringify(railData, null, 2)}

### Target Komponen: ${componentId || 'N/A'}

Sebagai teknisi, analisis:
1. Apakah rail voltage normal?
2. Apakah ada indikasi short atau open?
3. Komponen mana yang paling mungkin bermasalah?
4. Apa pengukuran berikutnya yang aman untuk dilakukan?

 ответ dalam Bahasa Indonesia dengan format profesional.
    `;

    try {
        const result = await model.generateContent(prompt);
        return { text: result.response.text() };
    } catch (e) {
        return { error: formatError(e) };
    }
}

export async function getTroubleshootingGuide(symptom) {
    if (!isConfigured()) {
        return { error: 'API Key belum diatur.' };
    }

    const prompt = `
## TROUBLESHOOTING GUIDE

### Gejala: ${symptom}

Sebagai teknisi HP berpengalaman, berikan:
1. Daftar kemungkinan penyebab (urutkan dari yang paling mungkin)
2. Prosedur diagnóstico yang aman
3. Pengukuran pertama yang建议 (paling informatif, risiko最小)
4. Warning signs yang menunjukkan harus berhenti

Gunakan format:
### Kemungkinan Penyebab:
1. [penyebab dengan probability]

### Prosedur Diagnosis:
- Langkah 1: [deskripsi]
- ...

### Warning Signs:
- [tanda-tanda yang menunjukkan kondisi buruk]
    `;

    try {
        const result = await model.generateContent(prompt);
        return { text: result.response.text() };
    } catch (e) {
        return { error: formatError(e) };
    }
}

function formatError(e) {
    if (e.message.includes('API_KEY')) {
        return 'API Key tidak valid. Silakan periksa kembali.';
    }
    if (e.message.includes('quota')) {
        return 'Kuota API habis. Silakan tunggu atau upgrade plan.';
    }
    if (e.message.includes('network') || e.message.includes('fetch')) {
        return 'Tidak dapat terhubung ke server. Periksa koneksi internet.';
    }
    return `Error: ${e.message}`;
}

export function resetChat() {
    if (model) {
        chatSession = model.startChat({
            history: [],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048,
            }
        });
    }
}

export function getApiKey() {
    return apiKey;
}

export function clearApiKey() {
    apiKey = null;
    model = null;
    chatSession = null;
    genAI = null;
}
