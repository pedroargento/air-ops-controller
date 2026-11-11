import { summarize } from '../../src/cli/batch';
import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import { runBattle } from '../../src/cli/battle';
import { policies } from '../../src/cli/policy-registry';
import { aircraftBeforeTick, aircraftPerformance, recordAircraftTick } from '../../src/sim/mission-report';
import { createInitialState } from '../../src/sim/state';
import { GameSession } from '../../src/game/session';
import { missionReportHtml } from '../../src/ui/mission-report';
import { step } from '../../src/sim/step';
import { gameplayHash } from '../../src/sim/state-hash';

const scenario = loadScenarioFile();

describe('aircraft accounting', () => {
  it('counts expenditure across rearming and records complete and incomplete sorties', () => {
    const state = createInitialState(scenario, 1);
    const a = state.truth.aircraft[0]!;
    const tick = (at: number, change: () => void) => {
      const before = aircraftBeforeTick(state.truth);
      change();
      recordAircraftTick(state.truth, before, scenario, at);
    };
    a.status = 'takeoff';
    a.ammunition = 2;
    a.gunBursts = 4;
    tick(10, () => { a.status = 'enroute'; });
    tick(11, () => { a.status = 'onStation'; a.ammunition -= 1; a.gunBursts -= 2; });
    tick(12, () => { a.landed = true; });
    tick(13, () => { a.landed = false; a.damaged = true; a.status = 'returning'; });
    tick(14, () => { a.status = 'turnaround'; });
    tick(15, () => { a.status = 'ready'; a.damaged = false; a.ammunition = 2; a.gunBursts = 4; });
    a.status = 'takeoff';
    tick(20, () => { a.status = 'enroute'; });
    tick(21, () => { a.ammunition -= 1; });
    const report = aircraftPerformance(state.truth, scenario)[0]!;
    expect(report).toMatchObject({ bombs: 2, gunBursts: 2, damageIncidents: 1, stationSeconds: 1, landedSeconds: 1 });
    expect(report.sorties).toEqual([{ departedAt: 10, returnedAt: 14 }, { departedAt: 20, returnedAt: null }]);
    expect(report.repairSeconds).toBe(scenario.file.air.models[a.model]?.repairSeconds);
  });

  it('counts overlapping illumination once, and does not count expired flares', () => {
    const state = createInitialState(scenario, 1);
    const a = state.truth.aircraft[0]!;
    const flare = { position: a.position, ignitedAt: 0, burnSeconds: 10, radiusMeters: 100, light: 1, by: a.id };
    state.truth.flares = [flare, { ...flare }];
    recordAircraftTick(state.truth, aircraftBeforeTick(state.truth), scenario, 9);
    recordAircraftTick(state.truth, aircraftBeforeTick(state.truth), scenario, 10);
    expect(a.record.illuminationSeconds).toBe(1);
  });

  it('agrees with strike events and casualty totals in a full battle', () => {
    const result = runBattle(scenario, 1, policies(scenario)['informed']!());
    expect(summarize('informed', [result]).meanSorties).toBe(result.aircraft.reduce((n, a) => n + a.sorties.length, 0));
    expect(result.aircraft.reduce((n, a) => n + a.bombs + a.gunBursts, 0)).toBe(result.strikePasses);
    expect(result.aircraft.reduce((n, a) => n + a.enemyCasualties, 0)).toBeGreaterThan(0);
    expect(result.aircraft.every((a) => a.firstAirSightings <= a.enemySquadsSeen)).toBe(true);
    expect(result.aircraft.reduce((n, a) => n + a.enemyCasualties, 0)).toBeLessThanOrEqual(result.casualties.enemy.killed + result.casualties.enemy.wounded);
  });

  it('does not let report counters influence battle decisions or randomness', () => {
    const first = createInitialState(scenario, 1);
    const second = createInitialState(scenario, 1);
    second.truth.aircraft[0]!.record.enemyCasualties = 999;
    second.truth.aircraft[0]!.record.observedSquads = ['E-N1/1'];
    for (let i = 0; i < 100; i += 1) { step(first, [], scenario); step(second, [], scenario); }
    expect(gameplayHash(first)).toBe(gameplayHash(second));
  });

  it('keeps accounting and diagnostics out of the replay hash', () => {
    const state = createInitialState(scenario, 1);
    const before = gameplayHash(state);
    // A counter added to the record later is covered too, since the whole record is left out.
    Object.assign(state.truth.aircraft[0]!.record, { enemyCasualties: 7, counterAddedLater: 3 });
    Object.values(state.truth.platoons)[0]!.drillWaitReason = 'support';
    expect(gameplayHash(state)).toBe(before);
    state.truth.aircraft[0]!.ammunition -= 1;
    expect(gameplayHash(state)).not.toBe(before);
  });
});

it('renders a factual, escaped report with zero casualties and never calls casualties kills', () => {
  const session = new GameSession({ ...scenario, file: { ...scenario.file, name: '<script>bad</script>', durationSeconds: 1 } }, 1);
  expect(session.debrief()).toBeNull();
  session.advance();
  const report = session.debrief()!;
  const html = missionReportHtml(report);
  expect(html).toContain('Aircraft performance');
  expect(html).toContain('Casualties and evacuation at mission end');
  expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('No sorties flown');
  expect(html).toContain('not kills alone');
});


it('keeps a recovered survivor in mission personnel totals after removal from the map', () => {
  const rescue = loadScenarioFile('downed-pilot');
  const policy = policies(rescue)['rescueNow']!();
  const session = new GameSession(rescue, 1);
  while (session.outcome === 'running') {
    if (session.tick % 5 === 0) for (const command of policy(session.view())) session.issue(command);
    session.advance();
  }
  const report = session.debrief()!;
  const initial = rescue.file.units.filter((u) => u.side === 'friendly').reduce((n, u) => n + u.personnel, 0);
  expect(report.friendlyStart).toBe(initial);
  expect(report.friendlyLeft).toBe(initial);
  expect(report.aircraft.reduce((n, a) => n + a.survivorsDelivered, 0)).toBe(1);
  expect(report.mission.evidence.join(' ')).toContain('delivered');
});
