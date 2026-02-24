import { bootEngine, dispatch, snapshot } from './adapter.js';

let currentScenarioId = 'default';

export async function loadScenario(scenarioId) {
    currentScenarioId = scenarioId;
    
    const action = {
        version: 1,
        kind: 'scenario',
        scenario: scenarioId
    };
    
    try {
        const result = JSON.parse(dispatch(JSON.stringify(action)));
        
        if (result.ok) {
            console.log('✅ Scenario loaded:', result.message);
            console.log('📊 Profile:', result.profile);
            return result;
        } else {
            console.error('❌ Failed to load scenario:', result.message);
            return result;
        }
    } catch (e) {
        console.error('❌ Error loading scenario:', e);
        return { ok: false, error: e.message };
    }
}

export function getCurrentScenarioId() {
    return currentScenarioId;
}

export function isScenarioLoaded() {
    return currentScenarioId !== 'default';
}

export async function resetToScenario(scenarioId) {
    await loadScenario(scenarioId);
    
    const snap = snapshot();
    return snap;
}

export function getScenarioInfo() {
    const scenarios = {
        'default': {
            name: 'Default',
            description: 'Free play mode',
            profile: { name: 'Ideal Bench', difficulty: 'easy' }
        },
        'power_drain_intermit': {
            name: 'Battery Drain',
            description: 'HP cepat habis baterai',
            profile: { name: 'Battery Drain Scenario', difficulty: 'medium' }
        },
        'fake_charging_drop': {
            name: 'Charging Issue',
            description: 'Indikator cas ada, baterai drop',
            profile: { name: 'Charging Issue', difficulty: 'hard' }
        },
        'rf_no_service_intermit': {
            name: 'RF No Service',
            description: 'Sinyal kadang muncul',
            profile: { name: 'RF Unstable', difficulty: 'hard' }
        },
        'thermal_shutdown': {
            name: 'Thermal Shutdown',
            description: 'HP mati karena panas',
            profile: { name: 'Thermal Risk', difficulty: 'medium' }
        },
        'usb_not_recognized': {
            name: 'USB Not Recognized',
            description: 'HP tidak terdeteksi di PC',
            profile: { name: 'Previously Repaired', difficulty: 'hard' }
        },
        'audio_no_sound': {
            name: 'Audio No Sound',
            description: 'Speaker tidak keluar suara',
            profile: { name: 'Previously Repaired', difficulty: 'medium' }
        },
        'touch_not_responsive': {
            name: 'Touch Unresponsive',
            description: 'Touchscreen tidak responsif',
            profile: { name: 'Previously Repaired', difficulty: 'hard' }
        },
        'bootloop': {
            name: 'Bootloop',
            description: 'Stuck di logo',
            profile: { name: 'Dead Device', difficulty: 'expert' }
        },
        'no_power_at_all': {
            name: 'Dead - No Power',
            description: 'HP tidak ada tanda kehidupan',
            profile: { name: 'Dead Device', difficulty: 'expert' }
        }
    };
    
    return scenarios[currentScenarioId] || scenarios['default'];
}

export async function initWithScenario(scenarioId = 'default') {
    await bootEngine();
    await loadScenario(scenarioId);
    return snapshot();
}
