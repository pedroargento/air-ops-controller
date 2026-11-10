import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import { runReplay } from '../../src/cli/replay';
import type { AircraftId } from '../../src/domain/public/air';
import { GameSession } from '../../src/game/session';
import { singleSquads } from '../support/single-squads';

const scenario = singleSquads(loadScenarioFile());
const center = scenario.file.mission.area.center;
const order = {
  kind: 'aircraftOrder',
  aircraftId: 'CAS-1' as AircraftId,
  order: { kind: 'Watch', center, radius: 500 },
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
    expect(session.view().aircraft).toHaveLength(5);
    expect(view).not.toContain('E-N1');
  });
});


it('keeps mission metrics private until completion and caches the completed report', () => {
  const short = { ...scenario, file: { ...scenario.file, durationSeconds: 2 } };
  const session = new GameSession(short, 1);
  expect(session.debrief()).toBeNull();
  session.advance();
  expect(session.debrief()).toBeNull();
  expect(JSON.stringify(session.view())).not.toContain('firstAirSightings');
  session.advance();
  const report = session.debrief();
  expect(report?.mission.elapsedSeconds).toBe(2);
  expect(report?.mission.evidence.join(' ')).toContain('effective defenders');
  expect(report?.aircraft).toHaveLength(5);
  expect(session.debrief()).toBe(report);
});
