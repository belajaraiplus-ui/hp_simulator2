import { State } from "../state.js";
import {
    voltageHistory,
    thermalHistory,
    distressHistory,
    diagnosticHistory,
    railVisibility,
    resmoothAll
} from "../state.js";
import { getCurrentScenario } from "../ui/scenario_selector.js";
import { exportTimelineSnapshots, getTimelineLength, importTimelineSnapshots } from "../ui/timeline.js";

const STORAGE_KEY = 'hp_simulator_save';
const PENDING_RESTORE_KEY = 'hp_simulator_pending_restore';

function cloneSerializable(value) {
    return JSON.parse(JSON.stringify(value));
}

function replaceObjectContents(target, source) {
    Object.keys(target).forEach((key) => delete target[key]);
    if (!source || typeof source !== "object") return;
    Object.entries(source).forEach(([key, value]) => {
        target[key] = Array.isArray(value) ? value.slice() : value;
    });
}

function parseSession(raw) {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") {
        throw new Error("Invalid session payload");
    }
    return data;
}

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
        scenario: cloneSerializable(getCurrentScenario()),
        scenarioId: getCurrentScenario()?.id || "default",
        lastSnapshot: cloneSerializable(State.get().lastSnapshot),
        state: {
            voltageHistory: cloneSerializable(voltageHistory),
            thermalHistory: cloneSerializable(thermalHistory),
            distressHistory: cloneSerializable(distressHistory),
            diagnosticHistory: cloneSerializable(diagnosticHistory.slice(-500)),
            railVisibility: cloneSerializable(railVisibility),
        },
        timelineSnapshots: cloneSerializable(exportTimelineSnapshots()),
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

        localStorage.setItem(PENDING_RESTORE_KEY, saved);
        alert('Session load queued. Restoring after reload...');
        window.location.reload();
    } catch (e) {
        console.error('Failed to load session:', e);
        alert('Failed to load session: ' + e.message);
    }
}

export function consumePendingRestore() {
    const pending = localStorage.getItem(PENDING_RESTORE_KEY);
    if (!pending) return null;
    try {
        const sessionData = parseSession(pending);
        localStorage.removeItem(PENDING_RESTORE_KEY);
        return sessionData;
    } catch (e) {
        console.error("Failed to parse pending restore:", e);
        localStorage.removeItem(PENDING_RESTORE_KEY);
        return null;
    }
}

export function applyRestoredSession(sessionData) {
    if (!sessionData || typeof sessionData !== "object") return false;

    const state = sessionData.state || {};
    replaceObjectContents(voltageHistory, state.voltageHistory);
    replaceObjectContents(thermalHistory, state.thermalHistory);
    replaceObjectContents(railVisibility, state.railVisibility);

    distressHistory.length = 0;
    if (Array.isArray(state.distressHistory)) {
        distressHistory.push(...state.distressHistory);
    }

    diagnosticHistory.length = 0;
    if (Array.isArray(state.diagnosticHistory)) {
        diagnosticHistory.push(...state.diagnosticHistory);
    }

    resmoothAll();
    importTimelineSnapshots(sessionData.timelineSnapshots);
    State.setSnapshot(sessionData.lastSnapshot || null);
    return true;
}

export function clearSavedSession() {
    if (confirm('Are you sure you want to delete the saved session?')) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(PENDING_RESTORE_KEY);
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
