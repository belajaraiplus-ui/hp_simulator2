import { State } from "../state.js";
import { voltageHistory, voltageSmoothed, thermalHistory, thermalSmoothed, distressHistory, diagnosticHistory } from "../state.js";
import { getCurrentScenario } from "../ui/scenario_selector.js";
import { getTimelineLength } from "../ui/timeline.js";

const STORAGE_KEY = 'hp_simulator_save';

export function initSaveLoad() {
    const saveBtn = document.getElementById('saveSession');
    const loadBtn = document.getElementById('loadSession');
    const clearBtn = document.getElementById('clearSave');

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            saveSession();
        });
    }

    if (loadBtn) {
        loadBtn.addEventListener('click', () => {
            loadSession();
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearSavedSession();
        });
    }

    console.log("Save/Load initialized");
}

export function saveSession() {
    const sessionData = {
        version: 1,
        timestamp: Date.now(),
        scenario: getCurrentScenario(),
        state: {
            voltageHistory,
            thermalHistory,
            distressHistory: distressHistory,
            diagnosticHistory: diagnosticHistory.slice(-50)
        },
        timelineLength: getTimelineLength()
    };

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
        alert('Session saved successfully!');
        console.log('Session saved:', sessionData);
    } catch (e) {
        console.error('Failed to save session:', e);
        alert('Failed to save session: ' + e.message);
    }
}

export function loadSession() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) {
            alert('No saved session found');
            return;
        }

        const sessionData = JSON.parse(saved);
        
        Object.assign(voltageHistory, sessionData.state.voltageHistory);
        Object.assign(thermalHistory, sessionData.state.thermalHistory);
        distressHistory.length = 0;
        distressHistory.push(...sessionData.state.distressHistory);
        
        diagnosticHistory.length = 0;
        if (sessionData.state.diagnosticHistory) {
            diagnosticHistory.push(...sessionData.state.diagnosticHistory);
        }

        State.setSnapshot(null);
        
        alert('Session loaded successfully!');
        console.log('Session loaded:', sessionData);
        
        window.location.reload();
    } catch (e) {
        console.error('Failed to load session:', e);
        alert('Failed to load session: ' + e.message);
    }
}

export function clearSavedSession() {
    if (confirm('Are you sure you want to delete the saved session?')) {
        localStorage.removeItem(STORAGE_KEY);
        alert('Saved session cleared');
    }
}

export function hasSavedSession() {
    return localStorage.getItem(STORAGE_KEY) !== null;
}

export function getSaveInfo() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    
    try {
        const data = JSON.parse(saved);
        return {
            timestamp: new Date(data.timestamp).toLocaleString(),
            scenario: data.scenario?.title || 'Unknown'
        };
    } catch {
        return null;
    }
}
