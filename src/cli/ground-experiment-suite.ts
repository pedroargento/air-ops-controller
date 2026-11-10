import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [stage, selected] = process.argv.slice(2);
if (!['screen', 'confirm', 'controls'].includes(stage ?? '') || (stage === 'confirm' && !/^[01]{3}$/.test(selected ?? ''))) {
  throw new Error('Usage: node --import tsx src/cli/ground-experiment-suite.ts screen|confirm|controls [selected-gates]');
}
const road = [['valley-road', 'none'], ['valley-road', 'routeRecon'], ['overwatch', 'none'], ['overwatch', 'routeReconCover']];
const controls = [['outpost-under-pressure', 'none'], ['outpost-under-pressure', 'informed'], ['outpost-night', 'none'], ['outpost-night', 'informedLit']];
const variants = stage === 'screen'
  ? [...Array.from({ length: 8 }, (_, n) => [n.toString(2).padStart(3, '0'), 'null']), ['111', '120']]
  : stage === 'confirm' ? [['111', 'null'], [selected, 'null'], ['111', '120']] : [['111', 'null'], ['111', '120']];
const directory = 'reports/ground-experiments';
mkdirSync(directory, { recursive: true });
const jobs = (stage === 'controls' ? controls : road).flatMap(([scenario, policy]) => variants.map(([mask, wait]) => {
  if (!scenario || !policy || !mask || !wait) throw new Error('Invalid experiment');
  return [scenario, policy, mask, stage === 'confirm' ? '101' : '1', stage === 'confirm' ? '200' : '100', wait,
    `${directory}/${stage}-${scenario}-${policy}-${mask}-${wait}.json`];
}));
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, async () => {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    if (!job) break;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/ground-experiments.ts', ...job], { stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Experiment exited ${code}: ${job.join(' ')}`)));
    });
  }
}));
