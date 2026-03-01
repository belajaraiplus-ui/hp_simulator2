import { State } from "../state.js";
import { voltageHistory, thermalHistory, distressHistory, diagnosticHistory } from "../state.js";

let timelineEnabled = false;
let savedSnapshots = [];

export function initTimeline() {
    const scrubber = document.getElementById('timelineScrubber');
    if (!scrubber) {
        console.warn('Timeline scrubber not found');
        return;
    }

    scrubber.addEventListener('input', (e) => {
        const index = parseInt(e.target.value);
        jumpToSnapshot(index);
    });

    scrubber.style.display = 'block';
    timelineEnabled = true;
    console.log("Timeline initialized");
}

export function saveSnapshot(snapshot) {
    if (!timelineEnabled) return;
    
    savedSnapshots.push({
        snapshot: JSON.parse(JSON.stringify(snapshot)),
        time: Date.now()
    });

    const maxSnapshots = 200;
    if (savedSnapshots.length > maxSnapshots) {
        savedSnapshots = savedSnapshots.slice(-maxSnapshots);
    }

    updateTimelineScrubber();
}

export function exportTimelineSnapshots() {
    return savedSnapshots.map((entry) => ({
        snapshot: JSON.parse(JSON.stringify(entry.snapshot)),
        time: Number.isFinite(entry.time) ? entry.time : Date.now(),
    }));
}

export function importTimelineSnapshots(entries) {
    if (!Array.isArray(entries)) {
        savedSnapshots = [];
        updateTimelineScrubber();
        return;
    }

    const normalized = entries
        .filter((entry) => entry && typeof entry === "object" && entry.snapshot != null)
        .map((entry) => ({
            snapshot: JSON.parse(JSON.stringify(entry.snapshot)),
            time: Number.isFinite(entry.time) ? entry.time : Date.now(),
        }));

    const maxSnapshots = 200;
    savedSnapshots = normalized.slice(-maxSnapshots);
    updateTimelineScrubber();
}

export function getTimelineSnapshots() {
    return savedSnapshots.map((entry) => entry.snapshot);
}

function updateTimelineScrubber() {
    const scrubber = document.getElementById('timelineScrubber');
    if (!scrubber) return;

    scrubber.max = Math.max(0, savedSnapshots.length - 1);
    scrubber.value = savedSnapshots.length - 1;

    const timeDisplay = document.getElementById('simTime');
    if (timeDisplay) {
        timeDisplay.textContent = savedSnapshots.length > 0 
            ? `Frame: ${savedSnapshots.length - 1}`
            : 'No data';
    }
}

function jumpToSnapshot(index) {
    if (index < 0 || index >= savedSnapshots.length) return;
    
    const saved = savedSnapshots[index];
    State.setSnapshot(saved.snapshot);
    window.dispatchEvent(new CustomEvent("timeline:jump", {
        detail: { index, snapshot: saved.snapshot }
    }));
    
    console.log(`Jumped to snapshot ${index}`);
}

export function clearTimeline() {
    savedSnapshots = [];
    updateTimelineScrubber();
}

export function getTimelineLength() {
    return savedSnapshots.length;
}

export function getCurrentTimelineIndex() {
    return savedSnapshots.length - 1;
}
