import { distressHistory, diagnosticHistory } from "../state.js";
import { getCurrentScenario } from "../ui/scenario_selector.js";

let sessionEnded = false;

export function computeOutcome() {
    if (sessionEnded) return null;
    sessionEnded = true;

    const scenario = getCurrentScenario();
    const finalDistress = distressHistory[distressHistory.length - 1] || 0;
    const distressTrend = analyzeFinalTrend();
    const measurements = countMeasurements();
    const timeSteps = distressHistory.length;

    let outcome = {
        label: determineOutcomeLabel(finalDistress, distressTrend),
        narrative: generateNarrative(scenario, finalDistress, distressTrend, measurements, timeSteps),
        metrics: {
            finalDistress: Math.round(finalDistress * 100),
            totalSteps: timeSteps,
            totalMeasurements: measurements,
            distressTrend
        }
    };

    return outcome;
}

function analyzeFinalTrend() {
    if (distressHistory.length < 5) return "stable";
    
    const recent = distressHistory.slice(-5);
    const first = recent[0];
    const last = recent[recent.length - 1];
    
    if (last - first > 0.1) return "rising";
    if (first - last > 0.1) return "falling";
    return "stable";
}

function countMeasurements() {
    return diagnosticHistory.length;
}

function determineOutcomeLabel(distress, trend) {
    if (distress > 0.8) {
        return "CRITICAL_FAILURE";
    } else if (distress > 0.5) {
        return trend === "rising" ? "ESCALATED_DAMAGE" : "PARTIAL_DAMAGE";
    } else if (distress > 0.2) {
        return trend === "rising" ? "RISK_ACCEPTED" : "STABLE_BUT_DEGRADED";
    } else if (trend === "falling") {
        return "SUCCESSFUL_RECOVERY";
    } else {
        return "STOPPED_EARLY";
    }
}

function generateNarrative(scenario, distress, trend, measurements, timeSteps) {
    const narratives = {
        "CRITICAL_FAILURE": `Perangkat mengalami kerusakan kritis setelah ${timeSteps} langkah. ` +
            `Tingkat distress mencapai ${Math.round(distress * 100)}%. ` +
            `Pengukuran yang dilakukan: ${measurements}. ` +
            `Kondisi terlalu buruk untuk dilanjutkan.`,
        
        "ESCALATED_DAMAGE": `Kondisi perangkat memburuk selama proses perbaikan. ` +
            `Dari ${measurements} kali pengukuran dalam ${timeSteps} langkah, ` +
            `distress meningkat menjadi ${Math.round(distress * 100)}%. ` +
            `Setiap tindakan memiliki konsekuensi.`,
        
        "PARTIAL_DAMAGE": `Perangkat mengalami kerusakan sebagian. ` +
            `Distress final: ${Math.round(distress * 100)}%. ` +
            `Dengan ${measurements} pengukuran, sebagian fungsi masih dapat dianalisis.`,
        
        "RISK_ACCEPTED": `Pengujian dilakukan dengan risiko yang diketahui. ` +
            `Distress meningkat ke ${Math.round(distress * 100)}% setelah ${measurements} pengukuran. ` +
            `Keputusan untuk melanjutkan adalah pilihan teknis.`,
        
        "STABLE_BUT_DEGRADED": `Perangkat dalam kondisi stabil namun sudah terdegradasi. ` +
            `Distress: ${Math.round(distress * 100)}% setelah ${timeSteps} langkah. ` +
            `Tidak ada perbaikan signifikan yang dicapai.`,
        
        "SUCCESSFUL_RECOVERY": `Kondisi perangkat membaik selama sesi. ` +
            `Distress turun dari awal hingga akhir menjadi ${Math.round(distress * 100)}%. ` +
            `${measurements} pengukuran dilakukan dengan hasil yang positif.`,
        
        "STOPPED_EARLY": `Sesi dihentikan lebih awal. ` +
            `Setelah ${timeSteps} langkah dan ${measurements} pengukuran, ` +
            `keputusan untuk berhenti adalah langkah yang valid.`
    };

    return narratives[determineOutcomeLabel(distress, trend)] || "Sesi selesai.";
}

export function showOutcomeModal() {
    const outcome = computeOutcome();
    if (!outcome) return;

    const modal = document.createElement('div');
    modal.id = 'outcomeModal';
    modal.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    const colors = {
        "CRITICAL_FAILURE": "#ff4500",
        "ESCALATED_DAMAGE": "#ff6b35",
        "PARTIAL_DAMAGE": "#ffa500",
        "RISK_ACCEPTED": "#ffd700",
        "STABLE_BUT_DEGRADED": "#87ceeb",
        "SUCCESSFUL_RECOVERY": "#28a745",
        "STOPPED_EARLY": "#6c757d"
    };

    const color = colors[outcome.label] || "#fff";

    modal.innerHTML = `
        <div style="
            background: #1e1e1e;
            padding: 30px;
            border-radius: 12px;
            max-width: 500px;
            border: 2px solid ${color};
        ">
            <h2 style="color: ${color}; margin-top: 0;">${outcome.label.replace(/_/g, ' ')}</h2>
            <p style="line-height: 1.6; color: #ddd;">${outcome.narrative}</p>
            <div style="background: #2a2a2a; padding: 15px; border-radius: 8px; margin-top: 20px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span class="muted">Final Distress:</span>
                    <span style="color: ${color};">${outcome.metrics.finalDistress}%</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span class="muted">Total Steps:</span>
                    <span>${outcome.metrics.totalSteps}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span class="muted">Measurements:</span>
                    <span>${outcome.metrics.totalMeasurements}</span>
                </div>
            </div>
            <button id="outcomeCloseBtn" style="
                margin-top: 20px;
                width: 100%;
                padding: 12px;
                background: ${color};
                border: none;
                border-radius: 6px;
                color: #fff;
                font-weight: bold;
                cursor: pointer;
            ">Tutup</button>
        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('outcomeCloseBtn').addEventListener('click', () => {
        document.body.removeChild(modal);
        sessionEnded = false;
    });
}

export function resetOutcome() {
    sessionEnded = false;
}
