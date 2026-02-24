import { State } from "../state.js";
import { voltageHistory, voltageSmoothed } from "../state.js";

let oscilloscopePanel = null;
let isRunning = false;
let selectedChannel = 'vbat';
let timeScale = 1;
let voltageScale = 1;
let triggerLevel = 0;
let channelData = {
    CH1: { color: '#00ff00', visible: true, data: [] },
    CH2: { color: '#ff6600', visible: false, data: [] },
    CH3: { color: '#00ccff', visible: false, data: [] }
};

export function createOscilloscopePanel() {
    oscilloscopePanel = document.createElement('div');
    oscilloscopePanel.id = 'oscilloscope-panel';
    oscilloscopePanel.innerHTML = `
        <div class="scope-header">
            <span class="scope-title">📟 Oscilloscope</span>
            <div class="scope-controls">
                <button id="scope-run" class="scope-btn active">▶ RUN</button>
                <button id="scope-stop" class="scope-btn">⏹ STOP</button>
                <button id="scope-single" class="scope-btn">SINGLE</button>
                <button id="scope-clear" class="scope-btn">CLEAR</button>
                <button id="scope-close" class="scope-btn">&times;</button>
            </div>
        </div>
        
        <div class="scope-display" id="scope-display">
            <canvas id="scope-canvas"></canvas>
            <div class="scope-grid"></div>
        </div>
        
        <div class="scope-channels">
            <div class="scope-channel" data-channel="CH1">
                <span class="channel-color" style="background: #00ff00;"></span>
                <span class="channel-name">CH1</span>
                <select class="channel-source">
                    <option value="vbat">VBAT</option>
                    <option value="vcore">VCORE</option>
                    <option value="vio">VIO</option>
                    <option value="vchg">VCHG</option>
                </select>
                <span class="channel-value">0.00 V</span>
            </div>
            <div class="scope-channel" data-channel="CH2">
                <span class="channel-color" style="background: #ff6600;"></span>
                <span class="channel-name">CH2</span>
                <select class="channel-source">
                    <option value="">OFF</option>
                    <option value="vbat">VBAT</option>
                    <option value="vcore">VCORE</option>
                    <option value="vio">VIO</option>
                </select>
                <span class="channel-value">-- V</span>
            </div>
            <div class="scope-channel" data-channel="CH3">
                <span class="channel-color" style="background: #00ccff;"></span>
                <span class="channel-name">CH3</span>
                <select class="channel-source">
                    <option value="">OFF</option>
                    <option value="vbat">VBAT</option>
                    <option value="vcore">VCORE</option>
                    <option value="vio">VIO</option>
                </select>
                <span class="channel-value">-- V</span>
            </div>
        </div>
        
        <div class="scope-settings">
            <div class="scope-setting">
                <label>Time/Div:</label>
                <select id="scope-timebase">
                    <option value="0.1">100ms</option>
                    <option value="0.5" selected>500ms</option>
                    <option value="1">1s</option>
                    <option value="2">2s</option>
                    <option value="5">5s</option>
                </select>
            </div>
            <div class="scope-setting">
                <label>Volt/Div:</label>
                <select id="scope-voltscale">
                    <option value="0.1">100mV</option>
                    <option value="0.5" selected>500mV</option>
                    <option value="1">1V</option>
                    <option value="2">2V</option>
                    <option value="5">5V</option>
                </select>
            </div>
            <div class="scope-setting">
                <label>Trigger:</label>
                <input type="range" id="scope-trigger" min="-5" max="5" step="0.1" value="0">
                <span id="scope-trigger-val">0V</span>
            </div>
        </div>
    `;

    const style = createOscilloscopeStyles();
    document.head.appendChild(style);

    setupOscilloscopeEvents();
    startOscilloscope();

    return oscilloscopePanel;
}

function createOscilloscopeStyles() {
    const style = document.createElement('style');
    style.textContent = `
        #oscilloscope-panel {
            position: fixed;
            left: 20px;
            top: 80px;
            width: 500px;
            background: #0a0a0a;
            border: 2px solid #333;
            border-radius: 8px;
            font-family: 'Consolas', 'Courier New', monospace;
            z-index: 9000;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }
        .scope-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background: #1a1a1a;
            border-bottom: 1px solid #333;
            border-radius: 6px 6px 0 0;
        }
        .scope-title {
            color: #ffcc00;
            font-size: 14px;
            font-weight: bold;
        }
        .scope-controls {
            display: flex;
            gap: 4px;
        }
        .scope-btn {
            padding: 4px 10px;
            background: #2a2a2a;
            border: 1px solid #444;
            border-radius: 4px;
            color: #888;
            font-size: 11px;
            cursor: pointer;
        }
        .scope-btn:hover { background: #3a3a3a; color: #fff; }
        .scope-btn.active { background: #006600; color: #fff; border-color: #00ff00; }
        
        .scope-display {
            position: relative;
            height: 200px;
            background: #000;
            overflow: hidden;
        }
        #scope-canvas {
            width: 100%;
            height: 100%;
        }
        .scope-grid {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background-image: 
                linear-gradient(rgba(0,50,0,0.3) 1px, transparent 1px),
                linear-gradient(90deg, rgba(0,50,0,0.3) 1px, transparent 1px),
                linear-gradient(rgba(0,80,0,0.5) 1px, transparent 1px),
                linear-gradient(90deg, rgba(0,80,0,0.5) 1px, transparent 1px);
            background-size: 20px 20px, 20px 20px, 100px 100px, 100px 100px;
            pointer-events: none;
        }
        
        .scope-channels {
            display: flex;
            background: #111;
            border-top: 1px solid #333;
            padding: 6px;
            gap: 8px;
        }
        .scope-channel {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            background: #1a1a1a;
            border-radius: 4px;
            font-size: 11px;
        }
        .channel-color {
            width: 10px;
            height: 10px;
            border-radius: 2px;
        }
        .channel-name {
            color: #888;
            font-weight: bold;
        }
        .channel-source {
            flex: 1;
            background: #0a0a0a;
            border: 1px solid #333;
            color: #fff;
            font-size: 10px;
            padding: 2px;
        }
        .channel-value {
            color: #00ff00;
            font-weight: bold;
            min-width: 55px;
            text-align: right;
        }
        
        .scope-settings {
            display: flex;
            gap: 12px;
            padding: 8px 12px;
            background: #111;
            border-top: 1px solid #333;
            border-radius: 0 0 6px 6px;
        }
        .scope-setting {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .scope-setting label {
            color: #666;
            font-size: 10px;
        }
        .scope-setting select, .scope-setting input {
            background: #0a0a0a;
            border: 1px solid #333;
            color: #fff;
            font-size: 10px;
            padding: 2px 4px;
        }
        #scope-trigger-val {
            color: #ffcc00;
            font-size: 10px;
            min-width: 30px;
        }
    `;
    return style;
}

function setupOscilloscopeEvents() {
    // Run/Stop buttons
    oscilloscopePanel.querySelector('#scope-run').addEventListener('click', () => {
        isRunning = true;
        updateRunState();
    });
    
    oscilloscopePanel.querySelector('#scope-stop').addEventListener('click', () => {
        isRunning = false;
        updateRunState();
    });
    
    oscilloscopePanel.querySelector('#scope-single').addEventListener('click', () => {
        captureSingle();
    });
    
    oscilloscopePanel.querySelector('#scope-clear').addEventListener('click', () => {
        clearChannels();
    });
    
    oscilloscopePanel.querySelector('#scope-close').addEventListener('click', () => {
        oscilloscopePanel.style.display = 'none';
    });

    // Channel sources
    oscilloscopePanel.querySelectorAll('.channel-source').forEach(select => {
        select.addEventListener('change', (e) => {
            const channel = e.target.closest('.scope-channel').dataset.channel;
            channelData[channel].visible = e.target.value !== '';
            channelData[channel].source = e.target.value;
        });
    });

    // Time scale
    oscilloscopePanel.querySelector('#scope-timebase').addEventListener('change', (e) => {
        timeScale = parseFloat(e.target.value);
    });

    // Voltage scale
    oscilloscopePanel.querySelector('#scope-voltscale').addEventListener('change', (e) => {
        voltageScale = parseFloat(e.target.value);
    });

    // Trigger
    oscilloscopePanel.querySelector('#scope-trigger').addEventListener('input', (e) => {
        triggerLevel = parseFloat(e.target.value);
        oscilloscopePanel.querySelector('#scope-trigger-val').textContent = triggerLevel.toFixed(1) + 'V';
    });

    // Canvas resize
    const canvas = oscilloscopePanel.querySelector('#scope-canvas');
    resizeCanvas(canvas);
    window.addEventListener('resize', () => resizeCanvas(canvas));
}

function resizeCanvas(canvas) {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}

function updateRunState() {
    oscilloscopePanel.querySelector('#scope-run').classList.toggle('active', isRunning);
    oscilloscopePanel.querySelector('#scope-stop').classList.toggle('active', !isRunning);
}

function clearChannels() {
    Object.keys(channelData).forEach(ch => {
        channelData[ch].data = [];
    });
    drawOscilloscope();
}

function captureSingle() {
    isRunning = false;
    updateRunState();
    
    // Capture one trace
    Object.keys(channelData).forEach(ch => {
        if (channelData[ch].visible && channelData[ch].source) {
            const source = channelData[ch].source.toLowerCase();
            const history = voltageHistory[source] || [];
            const recent = history.slice(-50);
            channelData[ch].data = [...recent];
        }
    });
    
    drawOscilloscope();
}

function startOscilloscope() {
    setInterval(() => {
        if (!isRunning || !oscilloscopePanel || oscilloscopePanel.style.display === 'none') return;
        
        // Update channel data from voltage history
        Object.keys(channelData).forEach(ch => {
            if (channelData[ch].visible && channelData[ch].source) {
                const source = channelData[ch].source.toLowerCase();
                const history = voltageHistory[source] || [];
                const recent = history.slice(-20);
                
                // Append new data
                channelData[ch].data = [...channelData[ch].data, ...recent].slice(-100);
                
                // Update value display
                const valueEl = oscilloscopePanel.querySelector(`[data-channel="${ch}"] .channel-value`);
                if (valueEl && recent.length > 0) {
                    valueEl.textContent = recent[recent.length - 1].toFixed(2) + ' V';
                }
            }
        });
        
        drawOscilloscope();
    }, 100);
}

function drawOscilloscope() {
    const canvas = oscilloscopePanel.querySelector('#scope-canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    
    // Center line
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h/2);
    ctx.lineTo(w, h/2);
    ctx.stroke();
    
    // Draw each channel
    Object.keys(channelData).forEach(ch => {
        if (!channelData[ch].visible || channelData[ch].data.length < 2) return;
        
        const data = channelData[ch].data;
        const color = channelData[ch].color;
        
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        const points = data.length;
        const xStep = w / Math.max(points, 1);
        
        data.forEach((val, i) => {
            // Scale voltage to canvas height (center = 0V)
            const y = h/2 - (val / voltageScale) * (h/10);
            const x = i * xStep;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        
        ctx.stroke();
        
        // Draw channel label
        ctx.fillStyle = color;
        ctx.font = '12px Consolas';
        ctx.fillText(ch, 10, 20 + Object.keys(channelData).indexOf(ch) * 15);
    });
}

export function showOscilloscope() {
    if (!oscilloscopePanel) {
        document.body.appendChild(createOscilloscopePanel());
    } else {
        oscilloscopePanel.style.display = 'block';
    }
}

export function hideOscilloscope() {
    if (oscilloscopePanel) {
        oscilloscopePanel.style.display = 'none';
    }
}

export function toggleOscilloscope() {
    if (!oscilloscopePanel || oscilloscopePanel.style.display === 'none') {
        showOscilloscope();
    } else {
        hideOscilloscope();
    }
}
