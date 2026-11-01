import { describe, expect, it } from 'vitest';
import { firstDivergence, runReplay } from '../../src/cli/replay';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import type { AircraftId } from '../../src/domain/public/air';
import type { PlayerCommand } from '../../src/domain/public/commands';

const scenario = loadScenarioFile();
const commands: readonly PlayerCommand[] = [
  { kind: 'aircraftOrder', tick: 1800, aircraftId: 'CAS-1' as AircraftId, order: { kind: 'ReturnToBase' } },
  {
    kind: 'aircraftOrder',
    tick: 1800,
    aircraftId: 'CAS-1' as AircraftId,
    order: { kind: 'SupportArea', center: scenario.file.mission.area.center, radius: 500 },
  },
];

describe('replay', () => {
  it('reproduces per-tick hashes for the same seed and commands', () => {
    const replay = { seed: 1, commands, ticks: 2400 };
    const first = runReplay(scenario, replay);
    const second = runReplay(scenario, replay);
    expect(first).toHaveLength(2400);
    expect(firstDivergence(first, second)).toBeNull();
  }, 30000);

  // Changes whenever rules or tuning change; update it deliberately with that change.
  it('matches the golden hash', () => {
    const hashes = runReplay(scenario, { seed: 1, commands: [], ticks: 3000 });
    expect(hashes.at(-1)).toBe('e2139fea');
  }, 30000);

  it('diverges when a command differs', () => {
    const base = runReplay(scenario, { seed: 1, commands: [], ticks: 1900 });
    const struck = runReplay(scenario, { seed: 1, commands, ticks: 1900 });
    expect(firstDivergence(base, struck)).toBe(1800);
  }, 30000);
});
