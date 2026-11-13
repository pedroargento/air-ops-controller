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
    order: { kind: 'Watch', center: scenario.file.mission.area.center, radius: 500 },
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
    // R0: the hash now leaves out report accounting and diagnostics (`src/sim/state-hash.ts`).
    // No rule changed then. R3.1 then made guns the crews' default weapons setting (2ba33c45 to a9161d09), and R3.2 put
    // air operations on one net (a9161d09 to 30a34f0e). R4.5 replaced the missile team's 4 missiles with a heavy
    // machine gun's 40 bursts (30a34f0e to a8cb8176), then moved the outpost's base to 40 km (a8cb8176 to ebd8876b)
    // and gave aircraft an out-of-action state for heavy damage (ebd8876b to fa6ab12f). The F-100D then starts with
    // less fuel (fa6ab12f to e922e264).
    expect(hashes.at(-1)).toBe('e922e264');
  }, 30000);

  it('diverges when a command differs', () => {
    const base = runReplay(scenario, { seed: 1, commands: [], ticks: 1900 });
    const struck = runReplay(scenario, { seed: 1, commands, ticks: 1900 });
    expect(firstDivergence(base, struck)).toBe(1800);
  }, 30000);
});
