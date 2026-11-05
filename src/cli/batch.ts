import { applySettings, settingsFromArgs } from './settings';
import type { DrillKind } from '../domain/public/ground';
// Usage: npx tsx src/cli/batch.ts [--scenario name] [--seeds 1000] [--policy name|all] [--without-drill a,b]
//        [--set path=value ...] [--json file]   e.g. --set combat.suppressionDecayPerUpdate=0.04 --set 'doctrines.*.pinnedSuppression=0.7'
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Policy } from '../policies/air-policies';
import type { Scenario } from '../scenario/load';
import type { GroundBehavior } from '../domain/public/ground';
import { runBattle, type BattleResult } from './battle';
import { DEFAULT_SCENARIO_NAME, loadScenarioFile } from './load-scenario';
import { policies } from './policy-registry';
import type { WithdrawalTrigger } from './tempo';

/** The same scenario with some drills forgotten, to measure what each is worth. */
function withoutDrills(scenario: Scenario, drills: readonly string[]): Scenario {
  const forget = <T extends Readonly<{ drills: readonly DrillKind[] }>>(doctrines: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(
      Object.entries(doctrines).map(([name, doctrine]) => [
        name,
        { ...doctrine, drills: doctrine.drills.filter((drill) => !drills.includes(drill)) },
      ]),
    );
  return { ...scenario, doctrines: forget(scenario.doctrines), file: { ...scenario.file, doctrines: forget(scenario.file.doctrines) } };
}

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

export type Summary = Readonly<{
  policy: string;
  seeds: number;
  winRate: number;
  failureRate: number;
  partialRate: number;
  meanEndMinutes: number;
  meanFriendlyLeft: number;
  meanEnemyLeft: number;
  meanSorties: number;
  meanStrikePasses: number;
  meanUnusedOrdnance: number;
  meanResponseMinutes: number | null;
  meanAircraftHits: number;
  runsWithHit: number;
  /** Per run, on average: killed, wounded, died of wounds, evacuated and still waiting (§8.9). */
  friendlyCasualties: CasualtySummary;
  enemyCasualties: CasualtySummary;
  meanHospitalMinutes: number | null;
  meanHelicopterHits: number;
  tempo: TempoSummary;
}>;

export type CasualtySummary = Readonly<{ killed: number; wounded: number; diedOfWounds: number; evacuated: number; aboard: number; waiting: number }>;

function casualtySummary(results: readonly BattleResult[], side: 'friendly' | 'enemy'): CasualtySummary {
  const of = (read: (ledger: BattleResult['casualties']['friendly']) => number): number => rounded(mean(results.map((r) => read(r.casualties[side]))));
  return { killed: of((l) => l.killed), wounded: of((l) => l.wounded), diedOfWounds: of((l) => l.diedOfWounds), evacuated: of((l) => l.evacuated), aboard: of((l) => l.aboard), waiting: of((l) => l.waiting) };
}

export type TempoSummary = Readonly<{
  fireMinuteShare: number;
  bouts: number;
  meanBoutMinutes: number;
  friendlyCasualtiesPerMinute: number;
  enemyCasualtiesPerMinute: number;
  suppressionRecoverySeconds: number | null;
  lowestGarrisonMorale: number;
  firstGarrisonFireMinute: number | null;
  firstDecisiveAssaultMinute: number | null;
  earliestFailureMinute: number | null;
  warningMinutes: number | null;
  withdrawals: Readonly<Record<WithdrawalTrigger, number>>;
  returnsPerRun: number;
  behaviorChangesPerRun: number;
  behaviorShare: Readonly<Record<GroundBehavior, number>>;
}>;

const mean = (values: readonly number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);

const rounded = (value: number): number => Number(value.toFixed(3));

/** Middle value, or null when no run produced one. */
function median(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const middle = present[Math.floor((present.length - 1) / 2)];
  return middle === undefined ? null : rounded(middle);
}

const toMinutes = (tick: number | null): number | null => (tick === null ? null : tick / 60);

function summarizeTempo(results: readonly BattleResult[]): TempoSummary {
  const tempos = results.map((r) => r.tempo);
  const captures = results.filter((r) => r.outcome === 'failure').map((r) => r.endedAtTick / 60);
  const withdrawals = { casualties: 0, morale: 0, suppression: 0, ammunition: 0, other: 0 };
  const seconds = { observe: 0, probe: 0, harass: 0, assault: 0, disengage: 0 };
  for (const tempo of tempos) {
    for (const key of Object.keys(withdrawals) as WithdrawalTrigger[]) withdrawals[key] += tempo.withdrawals[key];
    for (const key of Object.keys(seconds) as GroundBehavior[]) seconds[key] += tempo.behaviorSeconds[key];
  }
  const totalSeconds = Math.max(1, Object.values(seconds).reduce((sum, value) => sum + value, 0));
  const share = (key: GroundBehavior): number => rounded(seconds[key] / totalSeconds);
  return {
    fireMinuteShare: median(tempos.map((t) => t.fireMinuteShare)) ?? 0,
    bouts: median(tempos.map((t) => t.bouts)) ?? 0,
    meanBoutMinutes: median(tempos.map((t) => t.meanBoutSeconds / 60)) ?? 0,
    friendlyCasualtiesPerMinute: median(tempos.map((t) => t.friendlyCasualtiesPerMinute)) ?? 0,
    enemyCasualtiesPerMinute: median(tempos.map((t) => t.enemyCasualtiesPerMinute)) ?? 0,
    suppressionRecoverySeconds: median(tempos.map((t) => t.meanSuppressionRecoverySeconds)),
    lowestGarrisonMorale: median(tempos.map((t) => t.lowestGarrisonMorale)) ?? 0,
    firstGarrisonFireMinute: median(tempos.map((t) => toMinutes(t.firstGarrisonFireTick))),
    firstDecisiveAssaultMinute: median(tempos.map((t) => toMinutes(t.firstDecisiveAssaultTick))),
    earliestFailureMinute: captures.length > 0 ? rounded(Math.min(...captures)) : null,
    warningMinutes: median(tempos.map((t) => toMinutes(t.warningSeconds))),
    withdrawals,
    returnsPerRun: rounded(mean(tempos.map((t) => t.returns))),
    behaviorChangesPerRun: rounded(mean(tempos.map((t) => t.behaviorChanges))),
    behaviorShare: {
      observe: share('observe'),
      probe: share('probe'),
      harass: share('harass'),
      assault: share('assault'),
      disengage: share('disengage'),
    },
  };
}

/** Mean time from wound to hospital over everyone evacuated in all runs. */
function hospitalMinutes(results: readonly BattleResult[]): number | null {
  const evacuated = results.reduce((sum, r) => sum + r.casualties.friendly.evacuated, 0);
  if (evacuated === 0) return null;
  return rounded(results.reduce((sum, r) => sum + r.casualties.friendly.hospitalSeconds, 0) / evacuated / 60);
}

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
    winRate: rate('success'),
    failureRate: rate('failure'),
    partialRate: rate('partial'),
    meanEndMinutes: rounded(mean(results.map((r) => r.endedAtTick / 60))),
    meanFriendlyLeft: rounded(mean(results.map((r) => r.friendlyPersonnel))),
    meanEnemyLeft: rounded(mean(results.map((r) => r.enemyPersonnel))),
    meanSorties: rounded(mean(results.map((r) => r.sorties))),
    meanStrikePasses: rounded(mean(results.map((r) => r.strikePasses))),
    meanUnusedOrdnance: rounded(mean(results.map((r) => r.unusedOrdnance))),
    meanResponseMinutes: responses.length > 0 ? rounded(mean(responses)) : null,
    meanAircraftHits: rounded(mean(results.map((r) => r.aircraftHits))),
    runsWithHit: rounded(results.filter((r) => r.aircraftHits > 0).length / results.length),
    friendlyCasualties: casualtySummary(results, 'friendly'),
    enemyCasualties: casualtySummary(results, 'enemy'),
    meanHospitalMinutes: hospitalMinutes(results),
    meanHelicopterHits: rounded(mean(results.map((r) => r.helicopterHits))),
    tempo: summarizeTempo(results),
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
    return (result.outcome === 'success' ? 1 : 0) - (other?.outcome === 'success' ? 1 : 0);
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
  const scenario = applySettings(withoutDrills(loadScenarioFile(option('scenario', DEFAULT_SCENARIO_NAME)), process.argv.includes('--without-drill') ? option('without-drill', '').split(',') : []), settingsFromArgs(process.argv));
  const results: Record<string, readonly BattleResult[]> = {};
  const available = policies(scenario);
  if (which !== 'all' && available[which] === undefined) {
    throw new Error(`No policy "${which}" for ${scenario.file.id}. Available: ${Object.keys(available).join(', ')}`);
  }
  for (const [name, make] of Object.entries(available)) {
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
