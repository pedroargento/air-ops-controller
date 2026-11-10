import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GroundDiagnostics } from './ground-diagnostics';
import { discordanceProbability, pairedStatistics } from './paired-statistics';

type Row = { scenario: string; policy: string; mask: string; wait: number | null; seed: number;
  outcome: string; friendly: number; enemy: number; seconds: number; diagnostics: GroundDiagnostics['sides'] };
const directory = 'reports/ground-experiments';
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const success = (row: Row) => Number(row.outcome === 'success');
const groups = new Map<string, Row[]>();
for (const file of readdirSync(directory).filter((name) => /^(screen|confirm|controls)-.*\.json$/.test(name))) {
  const rows = JSON.parse(readFileSync(join(directory, file), 'utf8')) as Row[];
  for (const row of rows) {
    const key = `${file.split('-')[0]}/${row.scenario}/${row.policy}/${row.mask}/${row.wait}`;
    const group = groups.get(key) ?? [];
    if (group.some((r) => r.seed === row.seed)) throw new Error(`Duplicate seed: ${key}/${row.seed}`);
    group.push(row); groups.set(key, group);
  }
}
const summary = Object.fromEntries([...groups].map(([key, rows]) => [key, {
  n: rows.length, wins: rows.reduce((sum, row) => sum + success(row), 0),
  friendly: mean(rows.map((r) => r.friendly)), enemy: mean(rows.map((r) => r.enemy)), minutes: mean(rows.map((r) => r.seconds / 60)),
  diagnostics: Object.fromEntries((['friendly', 'enemy'] as const).map((side) => [side, {
    supportWaitSquadSeconds: mean(rows.map((r) => r.diagnostics[side].supportWaitSquadSeconds)),
    exposedSupportWaitSquadSeconds: mean(rows.map((r) => r.diagnostics[side].exposedSupportWaitSquadSeconds)),
    supportWaitPersonnelLost: mean(rows.map((r) => r.diagnostics[side].supportWaitPersonnelLost)),
    supportTimeouts: mean(rows.map((r) => r.diagnostics[side].supportTimeouts)),
    firingShare: mean(rows.map((r) => r.diagnostics[side].firingSquadSeconds / Math.max(1, r.diagnostics[side].activeSquadSeconds))),
    phaseSquadSeconds: Object.fromEntries(['approach', 'establish', 'maneuver', 'assault', 'steady', 'withdrawing', 'recovering', 'broken']
      .map((phase) => [phase, mean(rows.map((r) => r.diagnostics[side].phaseSquadSeconds[phase] ?? 0))])),
    waitSquadSeconds: Object.fromEntries(['support', 'assembly', 'doctrine', 'capacity']
      .map((reason) => [reason, mean(rows.map((r) => r.diagnostics[side].waitSquadSeconds[reason] ?? 0))])),
  }])),
}]));
const comparisons = Object.fromEntries([...groups].filter(([key]) => !key.endsWith('/111/null')).map(([key, rows]) => {
  const base = groups.get(`${key.split('/').slice(0, 3).join('/')}/111/null`);
  if (!base) throw new Error(`Missing baseline for ${key}`);
  const lookup = new Map(base.map((row) => [row.seed, row]));
  if (base.length !== rows.length) throw new Error(`Unmatched seed count for ${key}`);
  const paired = rows.map((row) => {
    const control = lookup.get(row.seed);
    if (!control) throw new Error(`Unmatched seed ${row.seed}`);
    return { row, control };
  });
  const metrics: Record<string, (r: Row) => number> = {
    success, friendly: (r) => r.friendly, enemy: (r) => r.enemy, minutes: (r) => r.seconds / 60,
  };
  return [key, Object.fromEntries(Object.entries(metrics).map(([metric, fn]) => {
    const stats = pairedStatistics(paired.map(({ row, control }) => fn(row) - fn(control)));
    return [metric, metric === 'success'
      ? { ...stats, exactDiscordanceP: discordanceProbability(stats.positive, stats.negative) } : stats];
  }))];
}));

// Main effects average over the other gates. Interactions are differences of differences.
// Negative coding means the gate is disabled; report the effect of enabling it.
const factorial = Object.fromEntries([...groups].filter(([key]) => key.startsWith('screen/') && key.endsWith('/111/null')).map(([key, base]) => {
  const prefix = key.split('/').slice(0, 3).join('/');
  const cells = Array.from({ length: 8 }, (_, i) => {
    const mask = i.toString(2).padStart(3, '0');
    const rows = groups.get(`${prefix}/${mask}/null`);
    if (!rows || rows.length !== base.length) throw new Error(`Incomplete factorial: ${prefix}`);
    return { mask, rows: new Map(rows.map((r) => [r.seed, r])) };
  });
  const effects = [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]];
  return [prefix, Object.fromEntries(effects.map((indices) => [indices.map((i) => ['support', 'assembly', 'reassessment'][i]).join(':'),
    Object.fromEntries((['success', 'friendly'] as const).map((metric) => [metric, pairedStatistics(base.map(({ seed }) =>
      cells.reduce((sum, cell) => {
        const row = cell.rows.get(seed);
        if (!row) throw new Error('Unmatched factorial seed');
        const sign = indices.reduce((product, i) => product * (cell.mask[i] === '1' ? 1 : -1), 1);
        return sum + sign * (metric === 'success' ? success(row) : row.friendly);
      }, 0) / (2 ** (3 - indices.length)),
    ))])),
  ]))];
}));
writeFileSync(join(directory, 'summary.json'), JSON.stringify({ summary, comparisons, factorial }, null, 2));
console.log(`Reported ${[...groups.values()].reduce((n, rows) => n + rows.length, 0)} battles in ${groups.size} groups`);
