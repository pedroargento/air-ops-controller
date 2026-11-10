import { writeFileSync } from 'node:fs';
import { runBattle } from './battle';
import { GroundDiagnostics } from './ground-diagnostics';
import { loadScenarioFile } from './load-scenario';
import { policies } from './policy-registry';
import { applySettings } from './settings';

// Positional interface keeps each job independently reproducible and safe to parallelize.
const [name, policy, mask, firstText, countText, waitText, output, mode = 'experimental'] = process.argv.slice(2);
if (!name || !policy || !mask || !/^[01]{3}$/.test(mask) || !output || !['standard', 'experimental'].includes(mode)) {
  throw new Error('Usage: node --import tsx src/cli/ground-experiments.ts SCENARIO POLICY GATES FIRST COUNT WAIT OUTPUT.json [standard|experimental]; GATES = support,assembly,reassessment (1 enabled); WAIT = null or seconds; default mode is experimental');
}
const first = Number(firstText), count = Number(countText);
const wait = waitText === 'null' ? null : Number(waitText);
if (!Number.isSafeInteger(first) || first < 1 || !Number.isSafeInteger(count) || count < 1 ||
  (wait !== null && (!Number.isFinite(wait) || wait <= 0))) throw new Error('Invalid seed range or wait budget');
const loaded = applySettings(loadScenarioFile(name), [`ground.experimentalTactics=${mode === 'experimental'}`]);
const scenario = { ...loaded,
  groundExperiment: { supportGate: mask[0] === '1', assemblyGate: mask[1] === '1', attackReassessment: mask[2] === '1' },
  doctrines: Object.fromEntries(Object.entries(loaded.doctrines).map(([id, doctrine]) => [id, { ...doctrine, supportWaitSeconds: wait }])),
};
const make = policies(scenario)[policy];
if (make === undefined) throw new Error(`Unknown policy ${policy}`);
const rows = [];
for (let seed = first; seed < first + count; seed++) {
  const diagnostics = new GroundDiagnostics();
  const result = runBattle(scenario, seed, make(), (state) => diagnostics.observe(state));
  rows.push({ scenario: name, policy, mode, mask, wait, seed, outcome: result.outcome,
    friendly: result.friendlyPersonnel, enemy: result.enemyPersonnel, seconds: result.endedAtTick,
    casualties: result.casualties, diagnostics: diagnostics.sides });
}
writeFileSync(output, JSON.stringify(rows));
console.log(`${name}/${policy} ${mode} gates=${mask} wait=${wait}: ${count} seeds complete`);
