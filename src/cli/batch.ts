// Usage: npx tsx src/cli/batch.ts [--seeds 1000] [--policy name|all] [--json file]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Policy } from '../policies/air-policies';
import type { Scenario } from '../scenario/load';
import { runBattle, type BattleResult } from './battle';
import { loadScenarioFile } from './load-scenario';
import { policies } from './policy-registry';

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

export type Summary = Readonly<{
  policy: string;
  seeds: number;
  winRate: number;
  capturedRate: number;
  belowStrengthRate: number;
  meanEndMinutes: number;
  meanFriendlyLeft: number;
  meanEnemyLeft: number;
  meanSorties: number;
  meanStrikePasses: number;
  meanUnusedOrdnance: number;
  meanResponseMinutes: number | null;
}>;

const mean = (values: readonly number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);

const rounded = (value: number): number => Number(value.toFixed(3));

export function summarize(policy: string, results: readonly BattleResult[]): Summary {
  const rate = (outcome: BattleResult['outcome']): number =>
    rounded(results.filter((r) => r.outcome === outcome).length / results.length);
  const responses = results.flatMap((r) =>
    r.firstRequestTick !== null && r.firstStrikeTick !== null
      ? [(r.firstStrikeTick - r.firstRequestTick) / 60]
      : [],
  );
  return {
    policy,
    seeds: results.length,
    winRate: rate('held'),
    capturedRate: rate('captured'),
    belowStrengthRate: rate('heldBelowStrength'),
    meanEndMinutes: rounded(mean(results.map((r) => r.endedAtTick / 60))),
    meanFriendlyLeft: rounded(mean(results.map((r) => r.friendlyPersonnel))),
    meanEnemyLeft: rounded(mean(results.map((r) => r.enemyPersonnel))),
    meanSorties: rounded(mean(results.map((r) => r.sorties))),
    meanStrikePasses: rounded(mean(results.map((r) => r.strikePasses))),
    meanUnusedOrdnance: rounded(mean(results.map((r) => r.unusedOrdnance))),
    meanResponseMinutes: responses.length > 0 ? rounded(mean(responses)) : null,
  };
}

export function runSeeds(
  scenario: Scenario,
  seeds: number,
  makePolicy: () => Policy,
): readonly BattleResult[] {
  return Array.from({ length: seeds }, (_, seed) => runBattle(scenario, seed, makePolicy()));
}

export type PairedDifference = Readonly<{ meanPoints: number; low: number; high: number }>;

/** Paired-seed 95% interval for the win-rate difference, in percentage points. */
export function pairedWinDifference(a: readonly BattleResult[], b: readonly BattleResult[]): PairedDifference {
  const differences = a.map((result, index) => {
    const other = b[index];
    return (result.outcome === 'held' ? 1 : 0) - (other?.outcome === 'held' ? 1 : 0);
  });
  const average = mean(differences);
  const variance = mean(differences.map((d) => (d - average) ** 2));
  const margin = 1.96 * Math.sqrt(variance / differences.length);
  return {
    meanPoints: rounded(average * 100),
    low: rounded((average - margin) * 100),
    high: rounded((average + margin) * 100),
  };
}

function main(): void {
  const seeds = Number(option('seeds', '1000'));
  const which = option('policy', 'all');
  const json = option('json', '');
  const scenario = loadScenarioFile();
  const results: Record<string, readonly BattleResult[]> = {};
  for (const [name, make] of Object.entries(policies(scenario))) {
    if (which === 'all' || which === name) results[name] = runSeeds(scenario, seeds, make);
  }
  const summaries = Object.entries(results).map(([name, r]) => summarize(name, r));
  console.log(JSON.stringify(summaries, null, 1));
  const informed = results['informed'];
  const silent = results['informedNoForward'];
  const reactive = results['reactive'];
  if (informed !== undefined && silent !== undefined) {
    console.log('forwarding benefit (points):', pairedWinDifference(informed, silent));
  }
  if (informed !== undefined && reactive !== undefined) {
    console.log('informed over reactive (points):', pairedWinDifference(informed, reactive));
  }
  if (json !== '') {
    mkdirSync(dirname(json), { recursive: true });
    writeFileSync(json, JSON.stringify(summaries, null, 2));
  }
}

if (process.argv[1]?.endsWith('batch.ts')) main();
