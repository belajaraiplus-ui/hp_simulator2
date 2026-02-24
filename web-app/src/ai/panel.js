import { chat, initAI, isConfigured, analyzePCB, analyzeCircuit, getTroubleshootingGuide, resetChat, clearApiKey } from '../ai/service.js';
import { State } from '../state.js';
import { voltageSmoothed, thermalSmoothed, distressHistory } from '../state.js';

let panel = null;
let apiKeyInput = null;
let isMinimized = false;

const QUICK_ACTIONS = [
    { label: '📊 Analisis Sistem', prompt: 'Analisis kondisi sistem saat ini berdasarkan data yang ada.' },
    { label: '🔧 Troubleshooting', prompt: 'Berikan panduan troubleshooting untuk masalah power.' },
    { label: '📈 Risk Assessment', prompt: 'Apa risiko jika melanjutkan pengukuran?' },
    { label: '💡 Saran Langkah', prompt: 'Apa langkah selanjutnya yang paling baik?' },
];

export function createAIPanel() {
    panel = document.createElement('div');
    panel.id = 'ai-panel';
    panel.innerHTML = `
        <div class="ai-header">
            <div class="ai-header-left">
                <span class="ai-status-dot" id="aiStatusDot"></span>
                <h3>🤖 AI Technician</h3>
            </div>
            <div class="ai-header-right">
                <button id="ai-minimize" class="ai-icon-btn" title="Minimize">─</button>
                <button id="ai-close" class="ai-icon-btn">&times;</button>
            </div>
        </div>
        
        <div class="ai-tabs">
            <button class="ai-tab active" data-tab="chat">Chat</button>
            <button class="ai-tab" data-tab="analyze">Analisis</button>
            <button class="ai-tab" data-tab="guide">Guide</button>
        </div>
        
        <div class="ai-content" id="ai-content">
            <div class="ai-view" id="ai-chat-view">
                <div class="ai-settings" id="ai-settings-panel">
                    <label>🔑 Google Gemini API Key:</label>
                    <input type="password" id="ai-api-key" placeholder="Paste API key di sini..." />
                    <button id="ai-save-key" class="ai-btn-primary">Connect</button>
                    <div class="ai-settings-note">Dapatkan API key gratis di <a href="https://aistudio.google.com/app/apikey" target="_blank">Google AI Studio</a></div>
                </div>
                <div class="ai-messages" id="ai-messages"></div>
                <div class="ai-quick-actions" id="ai-quick-actions" style="display: none;">
                    <div class="ai-quick-label">Quick Actions:</div>
                    <div class="ai-quick-btns"></div>
                </div>
                <div class="ai-input-area">
                    <input type="text" id="ai-input" placeholder="Tanyakan sesuatu..." />
                    <button id="ai-send">➤</button>
                </div>
            </div>
            
            <div class="ai-view" id="ai-analyze-view" style="display: none;">
                <div class="ai-analyze-content">
                    <div class="ai-analyze-section">
                        <h4>📊 Analisis PCB Otomatis</h4>
                        <p>Klik pada komponen di PCB viewer untuk analisis otomatis.</p>
                        <button id="ai-analyze-current" class="ai-btn-secondary">Analisis Kondisi Saat Ini</button>
                    </div>
                    <div class="ai-analyze-section">
                        <h4>🔌 Analisis Rail</h4>
                        <select id="ai-rail-select" class="ai-select">
                            <option value="">Pilih Rail...</option>
                        </select>
                        <button id="ai-analyze-rail" class="ai-btn-secondary">Analisis Rail</button>
                    </div>
                </div>
            </div>
            
            <div class="ai-view" id="ai-guide-view" style="display: none;">
                <div class="ai-guide-content">
                    <div class="ai-analyze-section">
                        <h4>🔧 Troubleshooting Guide</h4>
                        <input type="text" id="ai-symptom-input" placeholder="Contoh: HP tidak bisa cas, battery drop..." class="ai-input-full" />
                        <button id="ai-get-guide" class="ai-btn-primary">Dapatkan Guide</button>
                    </div>
                    <div class="ai-analyze-section">
                        <h4>⚡ Quick Guides</h4>
                        <div class="ai-guide-list">
                            <button class="ai-guide-item" data-symptom="battery drain">🔋 Battery Drain</button>
                            <button class="ai-guide-item" data-symptom="charging issue">🔌 Charging Issue</button>
                            <button class="ai-guide-item" data-symptom="no power">⚡ No Power</button>
                            <button class="ai-guide-item" data-symptom="overheating">🌡️ Overheating</button>
                            <button class="ai-guide-item" data-symptom="random shutdown">🔀 Random Shutdown</button>
                            <button class="ai-guide-item" data-symptom="dead">💀 Dead Device</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const style = createPanelStyles();
    document.head.appendChild(style);

    setupEventListeners();
    populateRailSelect();

    return panel;
}

function createPanelStyles() {
    const style = document.createElement('style');
    style.textContent = `
        #ai-panel {
            position: fixed;
            right: 80px;
            bottom: 20px;
            width: 400px;
            height: 550px;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 12px;
            display: flex;
            flex-direction: column;
            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
            z-index: 9999;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            transition: all 0.3s ease;
        }
        #ai-panel.minimized {
            height: 50px;
            overflow: hidden;
        }
        .ai-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: #161b22;
            border-radius: 12px 12px 0 0;
            border-bottom: 1px solid #30363d;
        }
        .ai-header-left {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .ai-status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #6e7681;
        }
        .ai-status-dot.connected {
            background: #3fb950;
            box-shadow: 0 0 8px #3fb950;
        }
        .ai-header h3 {
            margin: 0;
            color: #e6edf3;
            font-size: 14px;
            font-weight: 600;
        }
        .ai-header-right {
            display: flex;
            gap: 4px;
        }
        .ai-icon-btn {
            background: none;
            border: none;
            color: #8b949e;
            font-size: 16px;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
        }
        .ai-icon-btn:hover { background: #30363d; color: #e6edf3; }
        
        .ai-tabs {
            display: flex;
            background: #161b22;
            border-bottom: 1px solid #30363d;
        }
        .ai-tab {
            flex: 1;
            padding: 10px;
            background: none;
            border: none;
            color: #8b949e;
            cursor: pointer;
            font-size: 12px;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
        }
        .ai-tab:hover { color: #e6edf3; }
        .ai-tab.active {
            color: #58a6ff;
            border-bottom-color: #58a6ff;
        }
        
        .ai-content {
            flex: 1;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        .ai-view {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .ai-settings {
            padding: 16px;
            border-bottom: 1px solid #30363d;
            background: #161b22;
        }
        .ai-settings label {
            display: block;
            color: #e6edf3;
            font-size: 13px;
            margin-bottom: 8px;
        }
        .ai-settings input {
            width: 100%;
            padding: 10px 12px;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 6px;
            color: #e6edf3;
            font-size: 13px;
            box-sizing: border-box;
        }
        .ai-settings input:focus {
            border-color: #58a6ff;
            outline: none;
        }
        .ai-settings-note {
            margin-top: 8px;
            font-size: 11px;
            color: #8b949e;
        }
        .ai-settings-note a {
            color: #58a6ff;
            text-decoration: none;
        }
        
        .ai-btn-primary {
            width: 100%;
            margin-top: 10px;
            padding: 10px;
            background: #238636;
            border: none;
            border-radius: 6px;
            color: #fff;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        }
        .ai-btn-primary:hover { background: #2ea043; }
        
        .ai-btn-secondary {
            width: 100%;
            margin-top: 8px;
            padding: 8px 12px;
            background: #21262d;
            border: 1px solid #30363d;
            border-radius: 6px;
            color: #e6edf3;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .ai-btn-secondary:hover { background: #30363d; border-color: #8b949e; }
        
        .ai-messages {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }
        .ai-message {
            margin-bottom: 12px;
            padding: 10px 14px;
            border-radius: 12px;
            font-size: 13px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
            animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .ai-message.user {
            background: #1f6feb;
            color: #fff;
            margin-left: 20px;
            border-bottom-right-radius: 4px;
        }
        .ai-message.ai {
            background: #21262d;
            color: #e6edf3;
            margin-right: 20px;
            border-bottom-left-radius: 4px;
        }
        .ai-message.error {
            background: #da3633;
            color: #fff;
        }
        .ai-message.system {
            background: #30363d;
            color: #8b949e;
            font-size: 11px;
            text-align: center;
        }
        
        .ai-quick-actions {
            padding: 8px 12px;
            border-top: 1px solid #30363d;
            background: #161b22;
        }
        .ai-quick-label {
            font-size: 10px;
            color: #8b949e;
            margin-bottom: 6px;
        }
        .ai-quick-btns {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .ai-quick-btn {
            padding: 4px 8px;
            background: #21262d;
            border: 1px solid #30363d;
            border-radius: 12px;
            color: #8b949e;
            font-size: 10px;
            cursor: pointer;
        }
        .ai-quick-btn:hover { background: #30363d; color: #e6edf3; }
        
        .ai-input-area {
            display: flex;
            padding: 12px;
            border-top: 1px solid #30363d;
            gap: 8px;
            background: #161b22;
        }
        .ai-input-area input {
            flex: 1;
            padding: 10px 14px;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 20px;
            color: #e6edf3;
            font-size: 13px;
            outline: none;
        }
        .ai-input-area input:focus {
            border-color: #58a6ff;
        }
        .ai-input-area button {
            padding: 10px 16px;
            background: #238636;
            border: none;
            border-radius: 20px;
            color: #fff;
            font-size: 14px;
            cursor: pointer;
        }
        .ai-input-area button:hover { background: #2ea043; }
        
        .ai-analyze-content, .ai-guide-content {
            padding: 16px;
            overflow-y: auto;
        }
        .ai-analyze-section {
            margin-bottom: 20px;
        }
        .ai-analyze-section h4 {
            margin: 0 0 10px 0;
            color: #e6edf3;
            font-size: 13px;
        }
        .ai-analyze-section p {
            margin: 0 0 10px 0;
            color: #8b949e;
            font-size: 12px;
        }
        .ai-select, .ai-input-full {
            width: 100%;
            padding: 8px 12px;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 6px;
            color: #e6edf3;
            font-size: 13px;
            margin-bottom: 8px;
        }
        .ai-guide-list {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
        }
        .ai-guide-item {
            padding: 10px;
            background: #21262d;
            border: 1px solid #30363d;
            border-radius: 6px;
            color: #e6edf3;
            font-size: 12px;
            cursor: pointer;
            text-align: left;
            transition: all 0.2s;
        }
        .ai-guide-item:hover {
            background: #30363d;
            border-color: #58a6ff;
        }
    `;
    return style;
}

function setupEventListeners() {
    // Close and minimize
    panel.querySelector('#ai-close').addEventListener('click', () => {
        panel.style.display = 'none';
    });
    
    panel.querySelector('#ai-minimize').addEventListener('click', () => {
        isMinimized = !isMinimized;
        panel.classList.toggle('minimized', isMinimized);
        panel.querySelector('#ai-minimize').textContent = isMinimized ? '□' : '─';
    });

    // Save API Key
    panel.querySelector('#ai-save-key').addEventListener('click', async () => {
        const keyInput = panel.querySelector('#ai-api-key');
        const key = keyInput.value.trim();
        if (key) {
            const result = initAI(key);
            if (result.success) {
                addMessage('system', '✓ Terhubung dengan Gemini AI', 'system');
                addMessage('AI', 'Halo! Saya asisten teknisi Anda. Ada yang bisa saya bantu?', 'ai');
                showQuickActions(true);
                updateConnectionStatus(true);
                keyInput.value = '';
            } else {
                addMessage('AI', 'Error: ' + result.error, 'error');
            }
        }
    });

    // Tab switching
    panel.querySelectorAll('.ai-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            panel.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            panel.querySelectorAll('.ai-view').forEach(v => v.style.display = 'none');
            panel.querySelector(`#ai-${tab.dataset.tab}-view`).style.display = 'flex';
        });
    });

    // Chat send
    const sendBtn = panel.querySelector('#ai-send');
    const input = panel.querySelector('#ai-input');
    
    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // Quick actions
    QUICK_ACTIONS.forEach(action => {
        const btn = document.createElement('button');
        btn.className = 'ai-quick-btn';
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
            input.value = action.prompt;
            sendMessage();
        });
        panel.querySelector('.ai-quick-btns').appendChild(btn);
    });

    // Analyze current
    panel.querySelector('#ai-analyze-current')?.addEventListener('click', analyzeCurrentState);

    // Analyze rail
    panel.querySelector('#ai-analyze-rail')?.addEventListener('click', analyzeSelectedRail);

    // Get guide
    panel.querySelector('#ai-get-guide')?.addEventListener('click', () => {
        const symptom = panel.querySelector('#ai-symptom-input').value;
        if (symptom) getGuideForSymptom(symptom);
    });

    // Guide items
    panel.querySelectorAll('.ai-guide-item').forEach(item => {
        item.addEventListener('click', () => {
            getGuideForSymptom(item.dataset.symptom);
        });
    });
}

function showQuickActions(show) {
    const quickActions = panel.querySelector('#ai-quick-actions');
    if (quickActions) {
        quickActions.style.display = show ? 'block' : 'none';
    }
}

function updateConnectionStatus(connected) {
    const dot = panel.querySelector('#ai-status-dot');
    if (dot) {
        dot.classList.toggle('connected', connected);
    }
}

async function sendMessage() {
    const input = panel.querySelector('#ai-input');
    const userMessage = input.value.trim();
    if (!userMessage) return;

    addMessage('Anda', userMessage, 'user');
    input.value = '';

    if (!isConfigured()) {
        addMessage('AI', 'API Key belum diatur. Silakan masukkan API key di tab Settings.', 'error');
        return;
    }

    addMessage('AI', '⏳ Menganalisis...', 'ai', true);

    const context = getCurrentContext();
    const result = await chat(userMessage, { includeContext: true, context });

    const typingMsg = panel.querySelector('.ai-typing');
    if (typingMsg) typingMsg.remove();

    if (result.error) {
        addMessage('AI', 'Error: ' + result.error, 'error');
    } else {
        addMessage('AI', result.text, 'ai');
    }
}

function getCurrentContext() {
    const distress = distressHistory[distressHistory.length - 1] || 0;
    const voltages = {};
    const thermals = {};
    
    Object.keys(voltageSmoothed).forEach(k => {
        const vals = voltageSmoothed[k];
        if (vals.length > 0) voltages[k] = vals[vals.length - 1];
    });
    
    Object.keys(thermalSmoothed).forEach(k => {
        const vals = thermalSmoothed[k];
        if (vals.length > 0) thermals[k] = vals[vals.length - 1];
    });

    return { distress, voltages, thermals };
}

async function analyzeCurrentState() {
    if (!isConfigured()) {
        addMessage('AI', 'Silakan masukkan API key terlebih dahulu.', 'error');
        return;
    }

    const context = getCurrentContext();
    addMessage('Anda', 'Analisis kondisi sistem saat ini', 'user');
    addMessage('AI', '⏳ Menganalisis kondisi sistem...', 'ai', true);

    const prompt = `
Analisis kondisi sistem HP Repair Simulator saat ini:

Distress Level: ${(context.distress * 100).toFixed(1)}%
Voltage Readings: ${JSON.stringify(context.voltages)}
Thermal Readings: ${JSON.stringify(context.thermals)}

Sebagai teknisi profesional:
1. Apa penilaian Anda tentang kondisi sistem?
2. Apa risiko yang perlu diperhatikan?
3. Saran apa yang bisa Anda berikan?
`;
    const result = await chat(prompt, { includeContext: false });

    const typingMsg = panel.querySelector('.ai-typing');
    if (typingMsg) typingMsg.remove();

    if (result.error) {
        addMessage('AI', 'Error: ' + result.error, 'error');
    } else {
        addMessage('AI', result.text, 'ai');
    }
}

async function analyzeSelectedRail() {
    if (!isConfigured()) {
        addMessage('AI', 'Silakan masukkan API key terlebih dahulu.', 'error');
        return;
    }

    const railSelect = panel.querySelector('#ai-rail-select');
    const selectedRail = railSelect?.value;
    if (!selectedRail) {
        addMessage('AI', 'Pilih rail terlebih dahulu.', 'error');
        return;
    }

    const railVoltage = voltageSmoothed[selectedRail]?.[voltageSmoothed[selectedRail].length - 1];
    
    addMessage('Anda', `Analisis rail ${selectedRail}`, 'user');
    addMessage('AI', `⏳ Menganalisis rail ${selectedRail}...`, 'ai', true);

    const result = await analyzeCircuit({ name: selectedRail, voltage: railVoltage }, selectedRail);

    const typingMsg = panel.querySelector('.ai-typing');
    if (typingMsg) typingMsg.remove();

    if (result.error) {
        addMessage('AI', 'Error: ' + result.error, 'error');
    } else {
        addMessage('AI', result.text, 'ai');
    }
}

async function getGuideForSymptom(symptom) {
    if (!isConfigured()) {
        addMessage('AI', 'Silakan masukkan API key terlebih dahulu.', 'error');
        return;
    }

    // Switch to chat view and show the guide
    panel.querySelectorAll('.ai-tab')[0]?.click();
    
    addMessage('Anda', `Troubleshooting: ${symptom}`, 'user');
    addMessage('AI', `⏳ Mencari guide untuk "${symptom}"...`, 'ai', true);

    const result = await getTroubleshootingGuide(symptom);

    const typingMsg = panel.querySelector('.ai-typing');
    if (typingMsg) typingMsg.remove();

    if (result.error) {
        addMessage('AI', 'Error: ' + result.error, 'error');
    } else {
        addMessage('AI', result.text, 'ai');
    }
}

function populateRailSelect() {
    const railSelect = panel.querySelector('#ai-rail-select');
    if (!railSelect) return;

    railSelect.innerHTML = '<option value="">Pilih Rail...</option>';
    
    const rails = Object.keys(voltageSmoothed);
    rails.forEach(rail => {
        const option = document.createElement('option');
        option.value = rail;
        option.textContent = rail.toUpperCase();
        railSelect.appendChild(option);
    });
}

function addMessage(sender, text, type, isTyping = false) {
    const messagesContainer = panel.querySelector('#ai-messages');
    if (!messagesContainer) return;
    
    const div = document.createElement('div');
    div.className = `ai-message ${type}${isTyping ? ' ai-typing' : ''}`;
    div.textContent = text;
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

export function showAIPanel() {
    if (!panel) {
        document.body.appendChild(createAIPanel());
    } else {
        panel.style.display = 'flex';
    }
    populateRailSelect();
}

export function hideAIPanel() {
    if (panel) {
        panel.style.display = 'none';
    }
}

export function refreshRailList() {
    if (panel) {
        populateRailSelect();
    }
}
