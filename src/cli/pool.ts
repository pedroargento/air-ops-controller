// Runs a batch's battles across threads. Each battle depends only on its scenario, policy and
// seed, so the results are the same whatever the number of threads or the order they finish in.
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { runBattle, type BattleResult } from './battle';
import { policies } from './policy-registry';
import { buildScenario, type ScenarioSpec } from './scenario-spec';

export type SeedTask = Readonly<{ id: number; policy: string; seeds: readonly number[] }>;
export type SeedReply = Readonly<{ task: number; results: readonly BattleResult[] }>;

/** Small enough that threads finish together, large enough that messages don't dominate. */
const SEEDS_PER_TASK = 4;

/**
 * Half the logical processors: battles are memory-bound, and on a 16-core, 32-thread machine
 * 300 outpost seeds took 28 s on 16 threads against 33 s on 32.
 */
export function defaultJobs(): number {
  return Math.max(1, Math.floor(availableParallelism() / 2));
}

function tasksFor(policyNames: readonly string[], seeds: number): readonly SeedTask[] {
  const tasks: SeedTask[] = [];
  for (const policy of policyNames) {
    for (let from = 0; from < seeds; from += SEEDS_PER_TASK) {
      const chunk = Array.from({ length: Math.min(SEEDS_PER_TASK, seeds - from) }, (_, index) => from + index);
      tasks.push({ id: tasks.length, policy, seeds: chunk });
    }
  }
  return tasks;
}

function collect(policyNames: readonly string[], tasks: readonly SeedTask[], replies: ReadonlyMap<number, readonly BattleResult[]>): Record<string, readonly BattleResult[]> {
  const results: Record<string, BattleResult[]> = Object.fromEntries(policyNames.map((name) => [name, []]));
  // Tasks are in seed order within a policy, so appending in task order restores seed order.
  for (const task of tasks) results[task.policy]?.push(...(replies.get(task.id) ?? []));
  return results;
}

function runInProcess(spec: ScenarioSpec, tasks: readonly SeedTask[]): ReadonlyMap<number, readonly BattleResult[]> {
  const scenario = buildScenario(spec);
  const available = policies(scenario);
  const replies = new Map<number, readonly BattleResult[]>();
  for (const task of tasks) {
    const make = available[task.policy];
    if (make === undefined) throw new Error(`No policy "${task.policy}" for ${scenario.file.id}`);
    replies.set(task.id, task.seeds.map((seed) => runBattle(scenario, seed, make())));
  }
  return replies;
}

function runInWorkers(spec: ScenarioSpec, tasks: readonly SeedTask[], jobs: number): Promise<ReadonlyMap<number, readonly BattleResult[]>> {
  return new Promise((resolve, reject) => {
    const replies = new Map<number, readonly BattleResult[]>();
    const workers: Worker[] = [];
    let next = 0;
    let failed = false;
    const stop = (): void => {
      for (const worker of workers) void worker.terminate();
    };
    const fail = (error: unknown): void => {
      if (failed) return;
      failed = true;
      stop();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const give = (worker: Worker): void => {
      const task = tasks[next];
      if (task === undefined) return;
      next += 1;
      worker.postMessage(task);
    };
    for (let index = 0; index < jobs; index += 1) {
      const worker = new Worker(new URL('./batch-worker.ts', import.meta.url), { workerData: spec });
      workers.push(worker);
      worker.on('message', (reply: SeedReply) => {
        replies.set(reply.task, reply.results);
        if (replies.size === tasks.length) {
          stop();
          resolve(replies);
        } else {
          give(worker);
        }
      });
      worker.on('error', fail);
      worker.on('exit', (code) => {
        if (code !== 0 && replies.size < tasks.length) fail(new Error(`Batch worker stopped with code ${code}`));
      });
      give(worker);
    }
  });
}

/**
 * Every named policy over seeds 0 to `seeds - 1`, in seed order. One job runs in this thread;
 * more start that many workers, never more than there are tasks.
 */
export async function runPolicies(
  spec: ScenarioSpec,
  policyNames: readonly string[],
  seeds: number,
  jobs: number,
): Promise<Record<string, readonly BattleResult[]>> {
  const tasks = tasksFor(policyNames, seeds);
  const threads = Math.max(1, Math.min(Math.floor(jobs), tasks.length));
  const replies = threads === 1 ? runInProcess(spec, tasks) : await runInWorkers(spec, tasks, threads);
  return collect(policyNames, tasks, replies);
}
