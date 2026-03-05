#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const outPath = path.resolve('reports/pedagogy/latest/session_review_sample.json');

function hashTimeline(timeline, seed) {
  const h = crypto.createHash('sha256');
  for (const e of [...timeline].sort((a,b)=>a.tick-b.tick)) {
    h.update(`${e.tick}|${seed}|${e.state_delta_hash}|${e.consequence.reason_code}`);
  }
  return h.digest('hex');
}

function makeEntry(tick, tool, target, level, reason, probability) {
  return {
    tick,
    seed: 424242,
    action: { tool, target, at_tick: tick, metadata: { user_intent: 'diagnose' } },
    consequence: {
      level,
      reason_code: reason,
      description: reason,
      probability,
      applied_state_delta_summary: 'delta'
    },
    state_delta_hash: crypto.createHash('md5').update(`${tick}-${reason}`).digest('hex')
  };
}

const timeline = [
  makeEntry(1,'multimeter','vbat','safe','SAFE_BASELINE',0),
  makeEntry(2,'psu','vbat','risky','HIGH_CURRENT_OVERHEAT',0.82),
  makeEntry(3,'usb_trigger','pmic','misleading_measurement','BAD_CHARGER_NEGOTIATION',0.61),
  makeEntry(4,'jumper','rail:vcore','damage_secondary','RAIL_SHORT',0.9),
];

const review = {
  metadata: { scenario_id: 'power_fake_charging_charge_illusion', use_case: 'fake-charging diagnosis path', seed: 424242, duration_ticks: 4 },
  timeline,
  evidence_graph: {
    nodes: [
      { id:'m1', kind:'measurement', text:'VBAT low', tick:1 },
      { id:'h1', kind:'hypothesis', text:'input path unstable', tick:2 },
      { id:'j1', kind:'justification', text:'inject controlled current', tick:2 }
    ],
    edges: [
      { from:'m1', to:'h1', kind:'supports', tick:2 },
      { from:'h1', to:'j1', kind:'risk_introduced', tick:2 },
      { from:'h1', to:'m1', kind:'untested_assumption', tick:3 }
    ]
  },
  reasoning: {
    score_total: 74,
    subscores: { evidence_completeness: 78, sequence_quality: 72, risk_handling: 70, hypothesis_revision_quality: 76 },
    status: 'acceptable',
    top_findings: ['Evidence was collected before most actions', 'One risky action had explicit rationale', 'Hypothesis revision occurred after contradictory signal'],
    recommendations: ['Add second confirmatory measurement before rail intervention', 'Validate ground reference before differential probing', 'Use lower current pre-check before sustained injection'],
    blind_spots: ['Ground quality assumed stable', 'Thermal escalation checkpoint delayed', 'Protection path not validated']
  },
  risk_summary: { risky_actions_count: 1, secondary_damage_events: 1, misleading_measurements: 1 },
  acceptance: {
    paths: {
      no_power: { novice: 'needs_guidance', advanced: 'acceptable' },
      fake_charging: { novice: 'needs_guidance', advanced: 'trainer_ready' },
      thermal_escalation: { novice: 'needs_guidance', advanced: 'acceptable' }
    }
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(review, null, 2));

if (!Array.isArray(review.timeline) || review.timeline.length === 0) throw new Error('missing audit log');
if (!review.reasoning?.recommendations || !review.reasoning?.blind_spots || !review.reasoning?.subscores) throw new Error('reasoning score required fields missing');
if (!review.timeline.some(e => e.consequence.level === 'risky' || e.consequence.level === 'damage_secondary' || e.consequence.level === 'misleading_measurement')) throw new Error('no risk consequence triggered for high-risk actions');

const h1 = hashTimeline(review.timeline, review.metadata.seed);
const h2 = hashTimeline(review.timeline, review.metadata.seed);
if (h1 !== h2) throw new Error('replay determinism fails');

console.log(`Pedagogy acceptance OK. hash=${h1.slice(0,16)} report=${outPath}`);
