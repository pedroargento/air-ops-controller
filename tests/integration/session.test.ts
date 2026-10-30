import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import { runReplay } from '../../src/cli/replay';
import type { AircraftId } from '../../src/domain/public/air';
import { GameSession } from '../../src/game/session';

const scenario = loadScenarioFile();
const center = scenario.file.capture.area.center;
const order = {
  kind: 'aircraftOrder',
  aircraftId: 'CAS-1' as AircraftId,
  order: { kind: 'SupportArea', center, radius: 500 },
} as const;

describe('GameSession', () => {
  it('holds an action issued while paused until the next tick runs', () => {
    const session = new GameSession(scenario, 1);
    for (let i = 0; i < 10; i += 1) session.advance();
    session.issue(order);
    expect(session.commandLog().commands).toHaveLength(0);
    session.advance();
    expect(session.commandLog().commands).toEqual([{ ...order, tick: 10 }]);
  });

  it('a played session replays headlessly to the same state hash', () => {
    const session = new GameSession(scenario, 7);
    for (let i = 0; i < 1200; i += 1) {
      if (i === 300) session.issue(order);
      if (i === 900) session.issue({ kind: 'requestReport', unitId: 'F-A', report: 'sitrep' });
      session.advance();
    }
    const hashes = runReplay(scenario, session.commandLog());
    expect(hashes.at(-1)).toBe(session.stateHash());
  }, 30000);

  it('gives the view aircraft telemetry and no enemy unit IDs', () => {
    const session = new GameSession(scenario, 1);
    session.advance();
    const view = JSON.stringify(session.view());
    expect(session.view().aircraft).toHaveLength(3);
    expect(view).not.toContain('E-N1');
  });
});
