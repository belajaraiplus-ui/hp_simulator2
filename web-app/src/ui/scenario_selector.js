import { State } from "../state.js";
import { loadScenario } from "../engine/scenario.js";
import { faultSimulator } from "../physics/fault_simulator.js";
import { environmentEffects } from "../physics/effects.js";

export const SCENARIOS = [
    {
        id: "default",
        title: "Default - Free Play",
        description: "Mode bebas untuk testing dan eksperimen",
        complaint: "Tidak ada - mode latihan bebas",
        background: "Environment standar, semua alat tersedia",
        tools: "Semua alat tersedia (Multimeter, PSU, Oscilloscope)",
        timeLimit: "Tidak terbatas"
    },
    {
        id: "power_drain_intermit",
        title: "Scenario 1: Battery Drain Intermittent",
        description: "HP cepat habis baterai, kadang mati sendiri",
        complaint: "HP cepat habis baterai. Kadang mati sendiri, tapi kalau dicas lama normal lagi.",
        background: "Perangkat sudah pernah ganti baterai di tempat lain. Pemilik sering pakai charger mobil murah. Baterai bukan original.",
        tools: "Multimeter & PSU tersedia. Oscilloscope sedang dipinjam teknisi senior.",
        timeLimit: "Pemilik menunggu dan ingin hasil dalam 30 menit.",
        difficulty: "medium",
        hints: [
            "Perhatikan pola voltage saat idle",
            "Check untuk parasitic drain",
            "Riwayat charger murah bisa jadi faktor"
        ]
    },
    {
        id: "fake_charging_drop",
        title: "Scenario 2: Fake Charging Indicator",
        description: "Indikator cas ada, tapi baterai tetap drop",
        complaint: "Kalau dicas ada tanda petir, tapi persentase tidak naik. Kadang dari 80% tiba-tiba turun ke 20%.",
        background: "Perangkat sering dicas di mobil dan power bank murah. Pernah mati total lalu hidup lagi setelah dicas lama. IC charging mungkin sudah lemah.",
        tools: "PSU bench tersedia, tapi kabel USB sering longgar. Oscilloscope ada, namun jarang dipakai untuk charging case.",
        timeLimit: "Pemilik butuh cepat karena perangkat dipakai untuk kerja.",
        difficulty: "hard",
        hints: [
            "ukur tegangan pada jalur charging",
            "periksa arus yang diambil",
            "charging IC bisa jadi biang masalah"
        ]
    },
    {
        id: "rf_no_service_intermit",
        title: "Scenario 3: RF No Service Intermittent",
        description: "SIM terbaca, tapi tidak ada sinyal",
        complaint: "SIM terbaca, tapi tidak ada sinyal. Kadang muncul sebentar lalu hilang lagi.",
        background: "Perangkat pernah jatuh dan lama dipakai panas. Pernah diservis ringan tanpa catatan jelas. Ground RF mungkin sudah rusak.",
        tools: "Multimeter & PSU tersedia. Oscilloscope ada tapi jarang dipakai untuk RF. Tidak ada RF tester khusus.",
        timeLimit: "Pemilik ingin cepat karena perangkat dipakai untuk komunikasi utama.",
        difficulty: "hard",
        hints: [
            "RF sangat sensitif terhadap panas dan ground",
            "Pengukuran agresif bisa memperburuk",
            "Noise floor tinggi di workshop ini"
        ]
    },
    {
        id: "thermal_shutdown",
        title: "Scenario 4: Thermal Shutdown",
        description: "HP mati mendadak karena panas berlebihan",
        complaint: "HP terasa panas lalu mati sendiri. Setelah dingin bisa nyala lagi, tapi lama-lama sama.",
        background: "Perangkat dipakai gaming berat sambil dicas. Kipas sering tidak bekerja. Thermal paste sudah kering.",
        tools: "Multimeter untuk ukur suhu. Thermal camera tidak ada. PSU tersedia.",
        timeLimit: "Pemilik sedang butuh HP untuk deadline projekt.",
        difficulty: "medium",
        hints: [
            "Check zona termal yang hottest",
            "Thermal runaway bisa terjadi",
            "Pendinginan bisa temporer, bukan solusi"
        ]
    },
    {
        id: "usb_not_recognized",
        title: "Scenario 5: USB Not Recognized",
        description: "HP tidak terdeteksi saat koneksi ke PC",
        complaint: "HP tidak terdeteksi di PC. Kabel sudah diganti tapi tetap sama. Device manager menunjukkan unknown device.",
        background: "HP sering dipake transfer data via USB. Pernah masuk water damage sedikit (bekas percikan). USB IC mungkin affected.",
        tools: "Multimeter, PSU, USB tester sederhana.",
        timeLimit: "Data dalam HP sangat penting untuk dikeluarin.",
        difficulty: "hard",
        hints: [
            "Check tegangan pada USB port",
            "Data lines perlu diukur dengan teliti",
            "USB IC rentan terhadap water damage"
        ]
    },
    {
        id: "audio_no_sound",
        title: "Scenario 6: Audio No Sound",
        description: "Speaker tidak keluar suara, headset juga tidak",
        complaint: "Semua aplikasi yang butuh suara tidak bersuara. Sudah restart berkali-kali.",
        background: "HP pernah jatuh. Audio IC mungkin sudah loose. Software sudah di-reset tapi tetap sama.",
        tools: "Multimeter, oscilloscope untuk check audio signal.",
        timeLimit: "Tidak ada batas waktu, tapi butuh solusi.",
        difficulty: "medium",
        hints: [
            "Cek jalur audio dari IC ke speaker",
            "Check headset jack detect pin",
            "Audio amplifier perlu attention"
        ]
    },
    {
        id: "touch_not_responsive",
        title: "Scenario 7: Touch Screen Unresponsive",
        description: "Touchscreen tidak responsif atau sering error",
        complaint: "Layar sentuh sering tidak responsif. Kadang-kadang harus ditekan berkali-kali.",
        background: "HP pernah jatuh, layar retak tipis. Sudah diganti LCD tapi masalah sama.",
        tools: "Multimeter untuk check touchscreen controller. LCD/IC tester tidak ada.",
        timeLimit: "Pemilik mau HP tetap original, tidak换成机.",
        difficulty: "hard",
        hints: [
            "Touch controller butuh supply stabil",
            "Retak halus bisa cause intermittent issue",
            "LCD replacement tidak otomatis fix"
        ]
    },
    {
        id: "bootloop",
        title: "Scenario 8: Bootloop - Stuck di Logo",
        description: "HP terus restart terus-menerus di logo",
        complaint: "HP terus restart saja, tidak pernah masuk homescreen. Sudah尝试 hard reset.",
        background: "HP mati saat update software. Battery habis di tengah process. Flash memory mungkin corrupted.",
        tools: "JTAG/EDL mode tools tersedia untuk advanced recovery. Multimeter juga.",
        timeLimit: "Pemilik sudah kehilangan harapan, tapi masih Mau mencoba.",
        difficulty: "expert",
        hints: [
            "Bootloop biasanya software atau NAND issue",
            "Battery voltage harus stabil untuk boot",
            "EDL mode bisa bypass software untuk diagnosis"
        ]
    },
    {
        id: "no_power_at_all",
        title: "Scenario 9: Dead - No Power",
        description: "HP sama sekali tidak ada tanda kehidupan",
        complaint: "HP tidak nyala sama sekali. Tidak ada getaran, tidak ada LED, tidak ada display.",
        background: "HP sudah lama tidak dipakai. Terakhir dicharge tapi tidak mau. Battery mungkin benar-benar mati atau ada short.",
        tools: "PSU dengan current limit, Multimeter, Tools pembuka case.",
        timeLimit: "Ini adalah last resort scenario.",
        difficulty: "expert",
        hints: [
            "Start dengan cek battery voltage",
            "PMIC bisa jadi penyebab utama",
            "Short pada rails perlu dilacak"
        ]
    }
];

let currentScenario = SCENARIOS[0];

export function getCurrentScenario() {
    return currentScenario;
}

export function setScenario(scenarioId) {
    const scenario = SCENARIOS.find(s => s.id === scenarioId);
    if (scenario) {
        currentScenario = scenario;
        State.setScenario(scenario);
        
        loadScenario(scenarioId).then(result => {
            if (result.ok) {
                faultSimulator.initializeForScenario(scenarioId);
                
                if (result.profile) {
                    environmentEffects.setEnvironment(
                        result.profile.ambient_temperature,
                        result.profile.humidity_factor,
                        result.profile.emi_noise_floor
                    );
                }
                
                console.log('✅ Scenario and environment initialized:', scenario.title);
            }
        });
        
        console.log('Scenario selected:', scenario.title);
        return true;
    }
    return false;
}

export function getScenarios() {
    return SCENARIOS;
}

export function getScenariosByDifficulty(difficulty) {
    return SCENARIOS.filter(s => s.difficulty === difficulty);
}

export function initScenarioSelector() {
    const select = document.getElementById('scenarioSelect');
    if (!select) {
        console.warn('Scenario selector not found');
        return;
    }
    
    // Clear existing options
    select.innerHTML = '';
    
    // Group scenarios by category
    const categories = {
        'default': SCENARIOS.filter(s => s.id === 'default'),
        'easy': SCENARIOS.filter(s => s.difficulty === 'easy' || s.difficulty === 'medium'),
        'hard': SCENARIOS.filter(s => s.difficulty === 'hard' || s.difficulty === 'expert')
    };
    
    // Add default option
    const defaultOpt = document.createElement('option');
    defaultOpt.value = 'default';
    defaultOpt.textContent = '🎮 Free Play Mode';
    select.appendChild(defaultOpt);
    
    // Add difficulty headers and options
    const easyGroup = document.createElement('optgroup');
    easyGroup.label = '🟢 Easy - Medium';
    categories.easy.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.title;
        easyGroup.appendChild(opt);
    });
    select.appendChild(easyGroup);
    
    const hardGroup = document.createElement('optgroup');
    hardGroup.label = '🔴 Hard - Expert';
    categories.hard.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.title;
        hardGroup.appendChild(opt);
    });
    select.appendChild(hardGroup);
    
    select.addEventListener('change', (e) => {
        setScenario(e.target.value);
        updateScenarioDisplay();
    });
}

export function updateScenarioDisplay() {
    const label = document.getElementById('boardProfileLabel');
    if (label && currentScenario) {
        const difficultyColors = {
            'easy': '#28a745',
            'medium': '#ffc107',
            'hard': '#fd7e14',
            'expert': '#dc3545'
        };
        const color = difficultyColors[currentScenario.difficulty] || '#6c757d';
        label.innerHTML = `<span style="color: ${color}">${currentScenario.title}</span>`;
    }
    
    const scenarioInfo = document.getElementById('scenarioInfo');
    if (scenarioInfo && currentScenario) {
        let html = `
            <div class="scenario-detail">
                <strong>📝 Keluhan:</strong> ${currentScenario.complaint}
            </div>
        `;
        
        if (currentScenario.background) {
            html += `
                <div class="scenario-detail">
                    <strong>📖 Latar:</strong> ${currentScenario.background}
                </div>
            `;
        }
        
        if (currentScenario.tools) {
            html += `
                <div class="scenario-detail">
                    <strong>🔧 Tools:</strong> ${currentScenario.tools}
                </div>
            `;
        }
        
        if (currentScenario.timeLimit) {
            html += `
                <div class="scenario-detail">
                    <strong>⏱️ Batas Waktu:</strong> ${currentScenario.timeLimit}
                </div>
            `;
        }
        
        if (currentScenario.hints && currentScenario.hints.length > 0) {
            html += `<div class="scenario-hints"><strong>💡 Hints:</strong><ul>`;
            currentScenario.hints.forEach(hint => {
                html += `<li>${hint}</li>`;
            });
            html += `</ul></div>`;
        }
        
        scenarioInfo.innerHTML = html;
    }
}
