import { State } from "../state.js";
import { voltageHistory, thermalHistory, distressHistory, diagnosticHistory } from "../state.js";
import { getCurrentScenario } from "../ui/scenario_selector.js";

export function initExportReport() {
    const exportBtn = document.getElementById('exportReport');
    if (!exportBtn) {
        console.warn('Export button not found');
        return;
    }

    exportBtn.addEventListener('click', () => {
        exportSessionReport();
    });
}

export function exportSessionReport() {
    const scenario = getCurrentScenario();
    const snapshot = State.get().lastSnapshot;

    const report = {
        timestamp: new Date().toISOString(),
        scenario: {
            id: scenario.id,
            title: scenario.title,
            complaint: scenario.complaint,
            background: scenario.background
        },
        summary: generateSummary(snapshot),
        measurements: collectMeasurements(),
        diagnostic: collectDiagnostics(),
        distressHistory: distressHistory.slice(-50)
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hp-simulator-report-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('Report exported:', report);
    alert('Report exported successfully!');
}

function generateSummary(snapshot) {
    if (!snapshot) {
        return { status: 'No data', rails: [] };
    }

    const rails = Array.isArray(snapshot.rails) ? snapshot.rails.map(r => ({
        name: r.name,
        voltage: r.voltage,
        current: r.current
    })) : [];

    return {
        status: 'Completed',
        time: snapshot.time,
        distress: snapshot.distress,
        rails
    };
}

function collectMeasurements() {
    const measurements = [];
    
    Object.keys(voltageHistory).forEach(rail => {
        const history = voltageHistory[rail];
        if (history.length > 0) {
            const values = history.filter(v => v != null);
            if (values.length > 0) {
                measurements.push({
                    type: 'voltage',
                    target: rail,
                    count: values.length,
                    min: Math.min(...values),
                    max: Math.max(...values),
                    latest: values[values.length - 1]
                });
            }
        }
    });

    Object.keys(thermalHistory).forEach(zone => {
        const history = thermalHistory[zone];
        if (history.length > 0) {
            const values = history.filter(v => v != null);
            if (values.length > 0) {
                measurements.push({
                    type: 'thermal',
                    target: zone,
                    count: values.length,
                    min: Math.min(...values),
                    max: Math.max(...values),
                    latest: values[values.length - 1]
                });
            }
        }
    });

    return measurements;
}

function collectDiagnostics() {
    const diagnostics = diagnosticHistory.slice(-20).map(d => ({
        message: d.message,
        confidence: d.confidence,
        distress: d.distress
    }));
    return diagnostics;
}

export function exportCSV() {
    let csv = 'Time,Distress,Diagnostic\n';
    
    distressHistory.forEach((d, i) => {
        const diag = diagnosticHistory[i] || {};
        csv += `${i},${d},${diag.message || ''}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hp-simulator-data-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
