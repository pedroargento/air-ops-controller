import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareToBaseline } from '../../src/cli/batch';
import type { BattleResult } from '../../src/cli/battle';
import { runPolicies } from '../../src/cli/pool';

const SPEC = { name: 'find-them', withoutDrills: [], settings: [] };

function batchJson(jobs: number, directory: string): string {
  const file = join(directory, `jobs-${jobs}.json`);
  execFileSync('node_modules/.bin/tsx', ['src/cli/batch.ts', '--scenario', 'find-them', '--seeds', '6', '--jobs', String(jobs), '--json', file], { stdio: 'ignore' });
  return readFileSync(file, 'utf8');
}

describe('parallel batch', () => {
  it('gives the same file from one thread and from several', () => {
    const directory = mkdtempSync(join(tmpdir(), 'airops-batch-'));
    const single = batchJson(1, directory);
    expect(batchJson(3, directory)).toBe(single);
    expect((JSON.parse(single) as { summaries: unknown[] }).summaries.length).toBeGreaterThan(1);
  }, 60_000);

  it('returns every policy in seed order', async () => {
    const results = await runPolicies(SPEC, ['none', 'sweep'], 6, 1);
    expect(Object.keys(results)).toEqual(['none', 'sweep']);
    expect(results['sweep']?.map((result) => result.seed)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('baseline comparison', () => {
  const result = (outcome: BattleResult['outcome'], friendlyPersonnel: number): BattleResult =>
    ({ outcome, friendlyPersonnel, enemyPersonnel: 10, endedAtTick: 600 }) as BattleResult;

  it('pairs each seed with the same seed of the baseline', () => {
    const base = [result('failure', 10), result('failure', 20), result('success', 30), result('failure', 40)];
    const better = [result('success', 14), result('failure', 24), result('success', 34), result('failure', 44)];
    const comparison = compareToBaseline('better', better, 'none', base);
    // Every seed gains exactly four men, so the interval has no width although the seeds differ widely.
    expect(comparison.friendlyLeft).toEqual({ mean: 4, low: 4, high: 4 });
    expect(comparison.winPoints.mean).toBe(25);
    expect(comparison.gained).toBe(1);
    expect(comparison.lost).toBe(0);
    expect(comparison.endMinutes.mean).toBe(0);
  });

  it('refuses unequal seed counts', () => {
    expect(() => compareToBaseline('a', [result('success', 1)], 'none', [])).toThrow();
  });
});
