// One thread of a parallel batch: it builds the scenario once, then runs the seeds it is sent.
import { parentPort, workerData } from 'node:worker_threads';
import { runBattle } from './battle';
import { policies } from './policy-registry';
import type { SeedReply, SeedTask } from './pool';
import { buildScenario, type ScenarioSpec } from './scenario-spec';

const scenario = buildScenario(workerData as ScenarioSpec);
const available = policies(scenario);

parentPort?.on('message', (task: SeedTask) => {
  const make = available[task.policy];
  if (make === undefined) throw new Error(`No policy "${task.policy}" for ${scenario.file.id}`);
  const reply: SeedReply = { task: task.id, results: task.seeds.map((seed) => runBattle(scenario, seed, make())) };
  parentPort?.postMessage(reply);
});
