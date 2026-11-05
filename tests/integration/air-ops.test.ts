import { DAY_SKY } from '../support/sky';
import { describe, expect, it } from 'vitest';
import { firstDivergence, runReplay } from '../../src/cli/replay';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import type { AircraftId, AircraftOrder } from '../../src/domain/public/air';
import type { PlayerCommand } from '../../src/domain/public/commands';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import { distance, type Vec2 } from '../../src/domain/public/geometry';
import { emptyKnowledge, type ContactId } from '../../src/domain/public/ground';
import type { Aircraft, GroundUnit } from '../../src/domain/truth/world';
import { receiveByPlayer, updateContact, updateFriendly } from '../../src/knowledge/player-knowledge';
import { elevationAt, hasAirLos } from '../../src/domain/public/terrain';
import type { Weather } from '../../src/domain/public/weather';
import { GameSession } from '../../src/game/session';
import { project } from '../../src/knowledge/player-view';
import { reconInformed } from '../../src/policies/air-policies';
import { aircraftTelemetry } from '../../src/sim/air';
import { createInitialState, type SimState } from '../../src/sim/state';
import { platoonOf } from '../../src/sim/platoon';
import { step } from '../../src/sim/step';
import { sightOn } from '../../src/perception/observe';
import { singleSquads, squadOf } from '../support/single-squads';

const scenario = singleSquads(loadScenarioFile());
const { air, mission, radio: radioConfig } = scenario.file;
const CAS = 'CAS-1' as AircraftId;
const RECON = 'RECON-1' as AircraftId;
const outpost = mission.area.center;

function aircraft(state: SimState, id: AircraftId): Aircraft {
  const found = state.truth.aircraft.find((a) => a.id === id);
  if (found === undefined) throw new Error(`No aircraft ${id}`);
  return found;
}

function unit(state: SimState, id: string): GroundUnit {
  return squadOf(state.truth, id);
}

const order = (state: SimState, aircraftId: AircraftId, value: AircraftOrder): PlayerCommand => ({
  kind: 'aircraftOrder',
  tick: state.tick,
  aircraftId,
  order: value,
});

function run(state: SimState, ticks: number, commands: readonly PlayerCommand[] = []): void {
  step(state, commands, scenario);
  for (let i = 1; i < ticks && state.truth.outcome === 'running'; i += 1) step(state, [], scenario);
}

function isolate(state: SimState, keep: readonly string[]): void {
  state.truth.units = state.truth.units.filter((u) => keep.includes(u.platoonId));
  for (const id of Object.keys(state.truth.platoons)) {
    if (!keep.includes(id)) delete state.truth.platoons[id];
  }
}

const support = (center: Vec2, radius = 500): AircraftOrder => ({ kind: 'Watch', center, radius });
// What used to be Move to and Orbit: watching, with no orbit tighter than the type's own.
const watch = (center: Vec2, radius = 5000): AircraftOrder => ({ kind: 'Watch', center, radius });
const hold = (state: SimState, id: AircraftId): PlayerCommand => ({ kind: 'setWeapons', tick: state.tick, aircraftId: id, weapons: 'hold' });

describe('aircraft operations', () => {
  it('needs takeoff and travel time to reach the area', () => {
    const state = createInitialState(scenario, 1);
    run(state, 60, [hold(state, CAS), order(state, CAS, watch(outpost))]);
    expect(aircraft(state, CAS).status).not.toBe('onStation');
    run(state, 400);
    expect(aircraft(state, CAS).status).toBe('onStation');
  });

  it('transit time follows each model\'s real speed', () => {
    const state = createInitialState(scenario, 1);
    const eta = (id: AircraftId): number => {
      step(state, [hold(state, id), order(state, id, watch(outpost))], scenario);
      return aircraftTelemetry(state.truth, air).find((a) => a.aircraftId === id)?.etaSeconds ?? 0;
    };
    expect(eta('CAS-2' as AircraftId)).toBeLessThan(3.5 * 60);
    expect(eta(CAS)).toBeGreaterThan(5 * 60);
    expect(eta(CAS)).toBeLessThan(7 * 60);
    expect(eta(RECON)).toBeGreaterThan(9 * 60);
  });

  it('returns automatically before fuel runs out, then rearms after turnaround', () => {
    const state = createInitialState(scenario, 1);
    isolate(state, ['F-A']);
    const JET = 'CAS-2' as AircraftId;
    run(state, 1, [order(state, JET, support(outpost))]);
    const a = aircraft(state, JET);
    a.ammunition = 0;
    let landedWithFuel = -1;
    for (let tick = 0; tick < 4000 && a.status !== 'turnaround'; tick += 1) {
      step(state, [], scenario);
      landedWithFuel = a.fuelSeconds;
    }
    expect(a.status).toBe('turnaround');
    expect(landedWithFuel).toBeGreaterThan(0);
    run(state, air.models['F-100D']!.turnaroundSeconds + 1);
    expect(a.status).toBe('ready');
    expect(a.ammunition).toBe(air.models['F-100D']!.ammunition);
    expect(a.fuelSeconds).toBe(air.models['F-100D']!.fuelSeconds);
  });

  it('flies continuously: no jumps, and turns no faster than its turn rate', () => {
    const state = createInitialState(scenario, 1);
    isolate(state, ['F-A']);
    run(state, 1, [order(state, CAS, support(outpost))]);
    const a = aircraft(state, CAS);
    const type = air.models['A-1E']!;
    let reachedStation = false;
    let previous = a.position;
    let previousHeading = a.headingRad;
    let flying = false;
    for (let tick = 0; tick < 1200; tick += 1) {
      step(state, [], scenario);
      if (a.status === 'onStation') reachedStation = true;
      if (a.status === 'enroute' || a.status === 'onStation') {
        if (flying) {
          expect(distance(previous, a.position)).toBeLessThanOrEqual(type.speedMps + 1e-6);
          expect(Math.abs(a.headingRad - previousHeading)).toBeLessThanOrEqual(type.turnRateRadPerSecond + 1e-6);
        }
        flying = true;
      }
      previous = a.position;
      previousHeading = a.headingRad;
    }
    expect(reachedStation).toBe(true);
  });

  it('settles into an orbit around the assigned point', () => {
    const state = createInitialState(scenario, 1);
    isolate(state, ['F-A']);
    run(state, 1, [order(state, CAS, support(outpost))]);
    run(state, 420);
    const a = aircraft(state, CAS);
    expect(a.status).toBe('onStation');
    const gaps: number[] = [];
    for (let tick = 0; tick < 120; tick += 1) {
      step(state, [], scenario);
      gaps.push(distance(a.position, outpost));
    }
    expect(Math.max(...gaps)).toBeLessThan(air.models['A-1E']!.orbitRadiusMeters * 1.3);
    expect(Math.min(...gaps)).toBeGreaterThan(air.models['A-1E']!.orbitRadiusMeters * 0.7);
  });

  it('reports what the CAS crew is doing', () => {
    const state = createInitialState(scenario, 1);
    isolate(state, ['F-A']);
    run(state, 1, [order(state, CAS, support({ x: 4500, y: 1000 }))]);
    const phase = () => aircraftTelemetry(state.truth, air).find((a) => a.aircraftId === CAS)?.casPhase;
    expect(phase()).toBeNull();
    run(state, 500);
    expect(phase()).toBe('searching');
    aircraft(state, CAS).ammunition = 0;
    aircraft(state, CAS).gunBursts = 0;
    run(state, 1);
    expect(phase()).toBe('out-of-ordnance');
  });

  it('can be retasked in flight but rejects orders during turnaround', () => {
    const state = createInitialState(scenario, 1);
    run(state, 120, [order(state, CAS, support(outpost))]);
    const elsewhere = { x: 1000, y: 1000 };
    run(state, 1, [order(state, CAS, support(elsewhere))]);
    expect(aircraft(state, CAS).order).toEqual(support(elsewhere));

    const a = aircraft(state, CAS);
    a.status = 'turnaround';
    a.timerSeconds = 100;
    a.order = null;
    run(state, 1, [order(state, CAS, support(outpost))]);
    expect(a.order).toBeNull();
  });

  it('only CAS can take a fire mission', () => {
    const state = createInitialState(scenario, 1);
    run(state, 1, [order(state, RECON, { kind: 'Suppress', center: outpost, radius: 150, untilTick: 600 })]);
    run(state, 1, [order(state, RECON, { kind: 'Strike', center: outpost, radius: 150 })]);
    expect(aircraft(state, RECON).status).toBe('ready');
  });

  it('reports crisp telemetry for the player', () => {
    const state = createInitialState(scenario, 1);
    run(state, 100, [order(state, CAS, support(outpost))]);
    const entry = aircraftTelemetry(state.truth, air).find((a) => a.aircraftId === CAS);
    expect(entry?.position).toEqual(aircraft(state, CAS).position);
    expect(entry?.fuelFraction).toBeLessThan(1);
  });
});

describe('reconnaissance', () => {
  function reconRun() {
    const state = createInitialState(scenario, 2);
    isolate(state, ['F-A', 'E-N1']);
    const enemy = unit(state, 'E-N1');
    platoonOf(state.truth, enemy).activeFromTick = 100000;
    enemy.position = { x: 2525, y: 1850 };
    run(state, 1, [order(state, RECON, { kind: 'Watch', center: enemy.position, radius: 500 })]);
    run(state, 700);
    return state;
  }

  it('finds a contact that ground observers missed, and the player gets it without delay', () => {
    const state = reconRun();
    expect(Object.keys(state.unitKnowledge['F-A']?.contacts ?? {})).toHaveLength(0);
    const seen = Object.values(state.player.contacts).filter((c) => c.viaAircraft);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('does not automatically tell ground units what aircraft saw', () => {
    const state = reconRun();
    expect(Object.keys(state.unitKnowledge['F-A']?.reports ?? {})).toHaveLength(0);
  });

  it('logs only new or materially changed sightings', () => {
    const state = reconRun();
    const logged = state.player.log.filter((m) => m.senderId === RECON).length;
    expect(logged).toBeLessThan(10);
  });

  it('forwarding delivers the unchanged observation after a transmission delay', () => {
    const state = reconRun();
    const key = Object.keys(state.player.contacts).find((k) => k.startsWith(RECON)) as string;
    const original = state.player.contacts[key]?.contact as ContactEstimate;
    step(state, [{ kind: 'forwardContact', tick: state.tick, contactKey: key, recipients: ['F-A'] }], scenario);
    expect(Object.keys(state.unitKnowledge['F-A']?.reports ?? {})).toHaveLength(0);
    run(state, radioConfig.transmitSeconds + 1);
    const delivered = Object.values(state.unitKnowledge['F-A']?.reports ?? {});
    expect(delivered).toEqual([original]);
    expect(delivered[0]?.provenance.sourceId).toBe(RECON);
  });

  it('cannot forward to an enemy unit or an unknown contact', () => {
    const state = reconRun();
    const key = Object.keys(state.player.contacts)[0] as string;
    step(state, [{ kind: 'forwardContact', tick: state.tick, contactKey: key, recipients: ['E-N1'] }], scenario);
    step(state, [{ kind: 'forwardContact', tick: state.tick, contactKey: 'nope', recipients: ['F-A'] }], scenario);
    expect(state.radio.outbound).toHaveLength(0);
  });

  it('a forwarded report changes what a ground unit does', () => {
    const state = reconRun();
    const key = Object.keys(state.player.contacts).find((k) => k.startsWith(RECON)) as string;
    const before = unit(state, 'F-A').intent;
    const contact = state.player.contacts[key]?.contact as ContactEstimate;
    state.player.contacts[key] = {
      contact: { ...contact, identification: 'hostile', position: { ...contact.position, observedAt: state.tick } },
      receivedAt: state.tick,
      viaAircraft: true,
      status: 'active',
      statusAt: -1,
      estimatedLosses: 0,
      clearLookSeconds: 0,
    };
    step(state, [{ kind: 'forwardContact', tick: state.tick, contactKey: key, recipients: ['F-A'] }], scenario);
    run(state, radioConfig.transmitSeconds + 6);
    expect(before.kind).toBe('hold');
    expect(unit(state, 'F-A').intent.kind).toBe('move');
  });
});

describe('CAS engagement', () => {
  function casRun(enemyAt: Vec2, areaCenter: Vec2, seed = 3) {
    const state = createInitialState(scenario, seed);
    isolate(state, ['F-A', 'E-N1']);
    const enemy = unit(state, 'E-N1');
    platoonOf(state.truth, enemy).activeFromTick = 100000;
    enemy.position = enemyAt;
    run(state, 1, [order(state, CAS, support(areaCenter))]);
    return { state, enemy, plane: aircraft(state, CAS) };
  }

  it('spends nothing when the area holds no target, however long it orbits', () => {
    const { state, plane, enemy } = casRun({ x: 2525, y: 1000 }, { x: 4500, y: 4500 });
    run(state, 1000);
    expect(plane.ammunition).toBe(air.models['A-1E']!.ammunition);
    expect(enemy.personnel).toBe(enemy.initialPersonnel);
  });

  it('attacks a real target in discrete passes through shared combat state', () => {
    const { state, plane, enemy } = casRun({ x: 2525, y: 1700 }, { x: 2525, y: 1700 });
    run(state, 2500);
    const model = air.models['A-1E']!;
    const spent = model.ammunition - plane.ammunition + model.gunBursts - plane.gunBursts;
    expect(spent).toBeGreaterThan(0);
    expect(enemy.personnel).toBeLessThan(enemy.initialPersonnel);
    expect(state.player.log.filter((m) => m.kind === 'STRIKE_RESULT')).toHaveLength(spent);
  });

  it('never tells the player true casualties', () => {
    const { state } = casRun({ x: 2525, y: 1700 }, { x: 2525, y: 1700 });
    run(state, 1000);
    const strike = state.player.log.find((m) => m.kind === 'STRIKE_RESULT');
    expect(Object.keys(strike ?? {})).not.toContain('casualties');
  });

  it('never attacks a friendly unit', () => {
    const state = createInitialState(scenario, 3);
    isolate(state, ['F-A']);
    const friendly = unit(state, 'F-A');
    run(state, 1, [order(state, CAS, support(friendly.position))]);
    run(state, 1000);
    expect(friendly.personnel).toBe(friendly.initialPersonnel);
    expect(aircraft(state, CAS).ammunition).toBe(air.models['A-1E']!.ammunition);
  });

  it('leaves a strike mark for the map at the reported target', () => {
    const { state } = casRun({ x: 2525, y: 1700 }, { x: 2525, y: 1700 });
    run(state, 1000);
    expect(state.player.strikes.length).toBeGreaterThan(0);
    expect(state.player.strikes[0]?.aircraftId).toBe(CAS);
  });

  it('holds fire on a contact it has not identified', () => {
    const { state, plane, enemy } = casRun({ x: 2525, y: 1700 }, { x: 2525, y: 1700 });
    const original = scenario.file.perception.identifyPerScan;
    const blind = { ...scenario, file: { ...scenario.file, perception: { ...scenario.file.perception, identifyPerScan: 0 } } };
    for (let i = 0; i < 1000; i += 1) step(state, [], blind);
    expect(original).toBeGreaterThan(0);
    expect(plane.ammunition).toBe(air.models['A-1E']!.ammunition);
    expect(enemy.personnel).toBe(enemy.initialPersonnel);
  });

  it('finds targets sooner with a good recon cue, but a stale cue does not help', () => {
    const firstStrike = (cue: 'none' | 'good' | 'stale'): number => {
      let total = 0;
      for (let seed = 0; seed < 60; seed += 1) {
        const position = { x: 2525, y: 1500 };
        const { state } = casRun(position, position, seed);
        if (cue !== 'none') {
          const contact: ContactEstimate = {
            contactId: 'C-900' as ContactId,
            provenance: { sourceId: RECON, observedAt: cue === 'good' ? 300 : -5000 },
            identification: 'hostile',
            position: {
              center: position,
              sigmaMeters: 30,
              headingRad: null,
              speedMps: null,
              observedAt: cue === 'good' ? 300 : -5000,
            },
            strength: { kind: 'range', min: 15, max: 50 },
            kind: 'infantry',
            activity: 'stationary',
            confidence: 'high',
            observedWeapons: [],
          };
          updateContact(state.player, contact, 0, true);
        }
        let tick = 0;
        while (tick < 900 && !state.player.log.some((m) => m.kind === 'STRIKE_RESULT')) {
          step(state, [], scenario);
          tick += 1;
        }
        total += tick;
      }
      return total;
    };
    const uncued = firstStrike('none');
    expect(firstStrike('good')).toBeLessThan(uncued);
    expect(firstStrike('stale')).toBe(uncued);
  }, 60000);
});

describe('player radio actions', () => {
  it('a report request takes time and is answered from the unit\'s own knowledge', () => {
    const state = createInitialState(scenario, 4);
    isolate(state, ['F-A']);
    const requested = (): number => state.player.log.filter((m) => m.kind === 'SITREP').length;
    run(state, 1, [{ kind: 'requestReport', tick: state.tick, unitId: 'F-A', report: 'sitrep' }]);
    expect(requested()).toBe(0);
    // A report already on the air finishes first; the request then goes to the front of the queue.
    run(state, radioConfig.transmitSeconds * 3 + radioConfig.prepareSeconds + 2);
    expect(requested()).toBe(1);
  });

  it('a contact update with nothing to report comes back as a position report', () => {
    const state = createInitialState(scenario, 4);
    isolate(state, ['F-A']);
    run(state, 700);
    const before = state.player.log.filter((m) => m.kind === 'POSITION_REPORT').length;
    run(state, 80, [{ kind: 'requestReport', tick: state.tick, unitId: 'F-A', report: 'contact' }]);
    expect(state.player.log.filter((m) => m.kind === 'POSITION_REPORT').length).toBeGreaterThan(before);
    expect(state.player.log.filter((m) => m.kind === 'CONTACT_REPORT')).toHaveLength(0);
  });

  it('cannot address an enemy unit', () => {
    const state = createInitialState(scenario, 4);
    run(state, 1, [{ kind: 'requestReport', tick: state.tick, unitId: 'E-N1', report: 'position' }]);
    expect(state.radio.outbound).toHaveLength(0);
  });

  describe('CAS inbound', () => {
    function promised() {
      const state = createInitialState(scenario, 5);
      isolate(state, ['F-A']);
      const reported = unit(state, 'F-A').position;
      updateFriendly(
        state.player,
        'F-A',
        { center: reported, sigmaMeters: 40, headingRad: null, speedMps: null, observedAt: 0 },
        'self-report',
        0,
        120,
      );
      return { state, reported };
    }
    const ack = (state: SimState): PlayerCommand => ({
      kind: 'acknowledge',
      tick: state.tick,
      unitId: 'F-A',
      casAircraftId: CAS,
    });

    it('is unavailable without a qualifying aircraft assignment', () => {
      const { state } = promised();
      run(state, 1, [ack(state)]);
      expect(state.radio.outbound).toHaveLength(0);
      const far = createInitialState(scenario, 5);
      isolate(far, ['F-A']);
      run(far, 1, [order(far, CAS, support({ x: 100, y: 100 }))]);
      run(far, 1, [ack(far)]);
      expect(far.radio.outbound).toHaveLength(0);
    });

    it('gets its ETA from the real mission and updates the unit after a radio delay', () => {
      const { state, reported } = promised();
      run(state, 1, [order(state, CAS, support(reported))]);
      run(state, 1, [ack(state)]);
      expect(state.unitKnowledge['F-A']?.expectedSupport ?? null).toBeNull();
      run(state, radioConfig.transmitSeconds + 1);
      const expected = state.unitKnowledge['F-A']?.expectedSupport;
      expect(expected?.aircraftId).toBe(CAS);
      expect((expected?.etaAt ?? 0) - state.tick).toBeGreaterThan(200);
      expect(expected?.lapsesAt).toBe((expected?.etaAt ?? 0) + air.supportGraceSeconds);
    });

    it('sends a correction when the aircraft is diverted', () => {
      const { state, reported } = promised();
      run(state, 1, [order(state, CAS, support(reported))]);
      run(state, 30, [ack(state)]);
      expect(state.unitKnowledge['F-A']?.expectedSupport).not.toBeNull();
      run(state, 1, [order(state, CAS, support({ x: 100, y: 100 }))]);
      run(state, radioConfig.transmitSeconds + 8);
      expect(state.unitKnowledge['F-A']?.expectedSupport).toBeNull();
    });
  });
});

describe('replay with player commands', () => {
  const aircraftOrder: PlayerCommand = {
    kind: 'aircraftOrder',
    tick: 900,
    aircraftId: CAS,
    order: support(outpost),
  };

  it('reproduces the same hashes from a command log', () => {
    const replay = { seed: 6, commands: [aircraftOrder], ticks: 2000 };
    expect(firstDivergence(runReplay(scenario, replay), runReplay(scenario, replay))).toBeNull();
  }, 30000);

  it('diverges from the tick a command is applied', () => {
    const with_ = runReplay(scenario, { seed: 6, commands: [aircraftOrder], ticks: 1000 });
    const without = runReplay(scenario, { seed: 6, commands: [], ticks: 1000 });
    expect(firstDivergence(with_, without)).toBe(900);
  }, 30000);
});

describe('altitude and ground fire', () => {
  const team = { x: 2700, y: 2250 };
  const { MANPADS } = scenario.file.combat.weapons;
  const sure = {
    ...scenario,
    file: {
      ...scenario.file,
      combat: {
        ...scenario.file.combat,
        weapons: { ...scenario.file.combat.weapons, MANPADS: { ...MANPADS, airHitChance: 1000 } },
      },
      air: {
        ...air,
        groundNoticePerScan: 1,
        // Every hit counts here: surviving a hit has its own test.
        models: Object.fromEntries(
          Object.entries(air.models).map(([name, model]) => [name, { ...model, hitSurvivalChance: 0 }]),
        ),
      },
    },
  };

  function exposed(ticks: number): SimState {
    const state = createInitialState(sure, 1);
    isolate(state, ['E-AD']);
    step(state, [order(state, CAS, support(team))], sure);
    for (let i = 1; i < ticks && aircraft(state, CAS).damaged === false; i += 1) step(state, [], sure);
    return state;
  }

  it('is zero on the ground and the shared operating altitude in flight', () => {
    const state = createInitialState(scenario, 1);
    expect(aircraft(state, CAS).altitudeMeters).toBe(0);
    run(state, 30, [hold(state, CAS), order(state, CAS, watch(outpost))]);
    expect(aircraft(state, CAS).altitudeMeters).toBe(0);
    run(state, 60);
    run(state, 10, [hold(state, RECON), order(state, RECON, watch(outpost))]);
    run(state, 250);
    expect(aircraft(state, RECON).altitudeMeters).toBe(air.operatingAltitudeMeters);
    expect(aircraftTelemetry(state.truth, air).find((a) => a.aircraftId === RECON)?.altitudeMeters).toBe(air.operatingAltitudeMeters);
  });

  it('a hit damages the aircraft, ends its mission and sends it home', () => {
    const state = exposed(900);
    const plane = aircraft(state, CAS);
    expect(plane.damaged).toBe(true);
    expect(plane.status).toBe('returning');
    expect(plane.order).toBeNull();
    expect(state.truth.aircraft).toHaveLength(scenario.file.air.aircraft.length);
  });

  it('tells the player: telemetry at once, and a report with an estimated source', () => {
    const state = exposed(900);
    const entry = aircraftTelemetry(state.truth, air).find((a) => a.aircraftId === CAS);
    expect(entry?.damaged).toBe(true);
    const report = state.player.log.find((m) => m.kind === 'GROUND_FIRE');
    if (report?.kind !== 'GROUND_FIRE') throw new Error('no ground fire report');
    expect(report.hit).toBe(true);
    expect(report.source.sigmaMeters).toBe(air.groundFireSigmaMeters);
    expect(distance(report.source.center, team)).toBeLessThan(air.groundFireSigmaMeters * 5);
    expect(state.player.groundFire).toHaveLength(1);
  });

  it('a damaged aircraft refuses orders, does not attack, and needs the longer repair', () => {
    const state = exposed(900);
    const plane = aircraft(state, CAS);
    const ammunition = plane.ammunition;
    run(state, 1, [order(state, CAS, support(team))]);
    expect(plane.status).toBe('returning');
    expect(plane.order).toBeNull();
    for (let i = 0; i < 2000 && plane.status === 'returning'; i += 1) step(state, [], sure);
    expect(plane.status).toBe('turnaround');
    expect(plane.ammunition).toBe(ammunition);
    expect(plane.timerSeconds).toBe(air.models['A-1E']!.repairSeconds);
    for (let i = 0; i < air.models['A-1E']!.repairSeconds; i += 1) step(state, [], sure);
    expect(plane.status).toBe('ready');
    expect(plane.damaged).toBe(false);
  });

  it('damage corrects a CAS inbound promise, which takes time to arrive', () => {
    const state = createInitialState(sure, 1);
    isolate(state, ['E-AD', 'F-A']);
    // Far enough off that the garrison can't take the team out before it fires.
    unit(state, 'F-A').position = { x: 500, y: 500 };
    updateFriendly(state.player, 'F-A', { center: team, sigmaMeters: 30, headingRad: null, speedMps: null, observedAt: 0 }, 'self-report', 0, 120);
    step(state, [order(state, CAS, support(team))], sure);
    step(state, [{ kind: 'acknowledge', tick: state.tick, unitId: 'F-A', casAircraftId: CAS }], sure);
    for (let i = 0; i < 1000 && !aircraft(state, CAS).damaged; i += 1) step(state, [], sure);
    expect(aircraft(state, CAS).damaged).toBe(true);
    for (let i = 0; i < 120; i += 1) step(state, [], sure);
    expect(state.unitKnowledge['F-A']?.expectedSupport).toBeNull();
  });

  it('firing exposes the team: the aircraft comes to see its weapon', () => {
    const state = createInitialState(scenario, 1);
    isolate(state, ['E-AD']);
    const shooter = unit(state, 'E-AD');
    shooter.firedWeapons = ['MANPADS'];
    run(state, 500, [order(state, RECON, { kind: 'Watch', center: team, radius: 400 })]);
    shooter.lastFiredAtTick = state.tick;
    for (let i = 0; i < 300; i += 1) {
      shooter.lastFiredAtTick = state.tick;
      step(state, [], scenario);
    }
    const seen = Object.values(state.player.contacts).flatMap((c) => c.contact.observedWeapons);
    expect(seen).toContain('MANPADS');
  });

  it('an ordinary formation under an aircraft holds its fire', () => {
    const state = createInitialState(sure, 1);
    isolate(state, ['E-N2']);
    unit(state, 'E-N2').position = team;
    for (let i = 0; i < 800; i += 1) {
      const high = { kind: 'setAltitude', tick: 0, aircraftId: CAS, meters: 650 } as const;
      step(state, i === 0 ? [high, order(state, CAS, support(team))] : [], sure);
      expect(unit(state, 'E-N2').firesAtAircraft).toBe(false);
    }
    expect(aircraft(state, CAS).damaged).toBe(false);
  });

  it('a friendly unit with the same weapon does not fire on its own aircraft', () => {
    const state = createInitialState(sure, 1);
    isolate(state, ['F-A']);
    const friendly = unit(state, 'F-A');
    friendly.position = team;
    friendly.equipment = [{ weapon: 'MANPADS', quantity: 1, ammunition: 4 }];
    run(state, 800, [order(state, CAS, support(team))]);
    expect(aircraft(state, CAS).damaged).toBe(false);
    expect(friendly.equipment[0]?.ammunition).toBe(4);
  });

  it('goes to ground when aircraft appear, then gets on with the attack', () => {
    const state = createInitialState(sure, 1);
    isolate(state, ['E-N2']);
    const attacker = unit(state, 'E-N2');
    attacker.position = team;
    run(state, 1, [order(state, CAS, support(team))]);
    const taken: number[] = [];
    for (let i = 0; i < 700; i += 1) {
      const before = state.unitKnowledge['E-N2']?.hostileAircraftSeenAt ?? null;
      step(state, [], sure);
      const after = state.unitKnowledge['E-N2']?.hostileAircraftSeenAt ?? null;
      if (after !== before && after !== null) taken.push(after);
    }
    expect(taken.length).toBeGreaterThan(0);
    for (let i = 1; i < taken.length; i += 1) {
      expect((taken[i] ?? 0) - (taken[i - 1] ?? 0)).toBeGreaterThanOrEqual(attacker.doctrine.airCoverRepeatSeconds);
    }
  });

  it('replays ground fire deterministically', () => {
    const first = exposed(900);
    const second = exposed(900);
    expect(second.tick).toBe(first.tick);
    expect(second.player.log).toEqual(first.player.log);
  });
});

describe('reacting to known air threats', () => {
  const objective = outpost;
  const near = { x: objective.x + 200, y: objective.y };
  const hostile = (id: string, center: Vec2, observedWeapons: ContactEstimate['observedWeapons'] = []): ContactEstimate => ({
    contactId: id as ContactId,
    provenance: { sourceId: 'RECON-1', observedAt: 100 },
    identification: 'hostile',
    position: { center, sigmaMeters: 40, headingRad: null, speedMps: null, observedAt: 100 },
    strength: { kind: 'range', min: 30, max: 50 },
    kind: 'infantry',
    activity: 'moving',
    confidence: 'high',
    observedWeapons,
  });
  const ordersFor = (state: SimState) => {
    state.tick = 100;
    const view = project(state.player, aircraftTelemetry(state.truth, air), 100, scenario.file.display);
    return reconInformed(objective, false)(view).flatMap((c) =>
      c.kind === 'aircraftOrder' && c.aircraftId !== RECON && c.order.kind === 'Watch' ? [c.order.center] : [],
    );
  };
  it('goes after identified air defense first, even out of normal launch range', () => {
    const state = createInitialState(scenario, 1);
    const far = { x: objective.x, y: objective.y - 2000 };
    updateContact(state.player, hostile('C-1', near), 100, true);
    updateContact(state.player, hostile('C-2', far, ['MANPADS']), 100, true);
    expect(ordersFor(state)[0]).toEqual(far);
  });
});

describe('altitude control', () => {
  const setAltitude = (state: SimState, id: AircraftId, meters: number): PlayerCommand => ({
    kind: 'setAltitude',
    tick: state.tick,
    aircraftId: id,
    meters,
  });

  const airborne = (): SimState => {
    const state = createInitialState(scenario, 1);
    run(state, 200, [setAltitude(state, CAS, air.operatingAltitudeMeters), hold(state, CAS), order(state, CAS, watch(outpost))]);
    return state;
  };

  it('climbs and descends at the type\'s rate, not instantly', () => {
    const state = airborne();
    const plane = aircraft(state, CAS);
    run(state, 1, [setAltitude(state, CAS, 1000)]);
    expect(plane.altitudeMeters).toBe(air.operatingAltitudeMeters + air.models['A-1E']!.climbRateMps);
    run(state, 60);
    expect(plane.altitudeMeters).toBe(1000);
    run(state, 1, [setAltitude(state, CAS, 200)]);
    expect(plane.altitudeMeters).toBe(1000 - air.models['A-1E']!.climbRateMps);
  });

  it('stays inside the type\'s limits', () => {
    const state = airborne();
    run(state, 1, [setAltitude(state, CAS, 99999)]);
    expect(aircraft(state, CAS).targetAltitudeMeters).toBe(air.models['A-1E']!.maxAltitudeMeters);
    run(state, 1, [setAltitude(state, CAS, 0)]);
    expect(aircraft(state, CAS).targetAltitudeMeters).toBe(air.models['A-1E']!.minAltitudeMeters);
  });

  it('survives a change of mission and is flown to after takeoff', () => {
    const state = createInitialState(scenario, 1);
    run(state, 1, [setAltitude(state, CAS, 800)]);
    expect(aircraft(state, CAS).altitudeMeters).toBe(0);
    run(state, 200, [hold(state, CAS), order(state, CAS, watch(outpost))]);
    run(state, 1, [hold(state, CAS), order(state, CAS, watch(outpost, 500))]);
    expect(aircraft(state, CAS).targetAltitudeMeters).toBe(800);
    expect(aircraft(state, CAS).altitudeMeters).toBe(800);
  });

  // A stationary team under an orbiting recon, so that only altitude differs.
  function sightings(meters: number): number {
    let total = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      const state = createInitialState(scenario, seed);
      isolate(state, ['E-W']);
      const startup = [
        setAltitude(state, RECON, meters),
        order(state, RECON, { kind: 'Watch', center: unit(state, 'E-W').position, radius: 500 }),
      ];
      run(state, 900, startup);
      total += Object.keys(state.player.contacts).length === 0 ? 0 : 1;
    }
    return total;
  }

  it('sees less from higher up', () => {
    expect(sightings(3000)).toBeLessThan(sightings(200));
  });

  function strikeEffect(meters: number): number {
    let effects = 0;
    for (let seed = 0; seed < 30; seed += 1) {
      const state = createInitialState(scenario, seed);
      isolate(state, ['E-W']);
      const target = unit(state, 'E-W');
      run(state, 1, [setAltitude(state, CAS, meters), order(state, CAS, support(target.position))]);
      run(state, 1000);
      effects += state.player.log.filter((m) => m.kind === 'STRIKE_RESULT' && m.effect === 'effect-observed').length;
    }
    return effects;
  }

  it('strikes less accurately from higher up', () => {
    expect(strikeEffect(2500)).toBeLessThan(strikeEffect(300));
  });

  it('replays altitude changes', () => {
    const state = createInitialState(scenario, 3);
    const log = {
      scenarioId: scenario.file.id,
      seed: 3,
      ticks: 300,
      commands: [{ kind: 'setAltitude', tick: 5, aircraftId: CAS, meters: 900 } satisfies PlayerCommand],
    };
    expect(state.tick).toBe(0);
    expect(runReplay(scenario, log as never)).toEqual(runReplay(scenario, log as never));
  });
});

describe('battle damage in play', () => {
  it('a strike that kills its target reports it destroyed, with the crew\'s estimate', () => {
    // The crew doesn't always see the result of the pass that does it, so this takes a few runs.
    const reported = [1, 2, 3, 4, 5, 6].flatMap((seed) => {
      const state = createInitialState(scenario, seed);
      isolate(state, ['E-W']);
      const target = unit(state, 'E-W');
      target.personnel = 1;
      run(state, 1000, [order(state, CAS, support(target.position))]);
      const strikes = state.player.log.flatMap((m) => (m.kind === 'STRIKE_RESULT' ? [m] : []));
      return strikes.some((m) => m.assessment?.destroyed === true) ? [state] : [];
    });
    expect(reported.length).toBeGreaterThan(0);
    expect(reported[0]?.player.confirmedDestroyed).toBe(1);
  });

  it('a debrief exists only once the run is over', () => {
    const session = new GameSession(scenario, 1);
    expect(session.debrief()).toBeNull();
    while (session.outcome === 'running') session.advance();
    expect(session.debrief()?.enemyFormations).toBe(scenario.file.units.filter((u) => u.side === 'enemy').length);
  });
});

describe('terrain and aircraft', () => {
  // A wall of high ground between x 2000 and 2100, with everything else low.
  function walled(): typeof scenario {
    const { terrain } = scenario;
    const elevation = new Float32Array(terrain.elevation.length).fill(20);
    for (let row = 0; row < terrain.height; row += 1) {
      for (let column = 40; column < 42; column += 1) elevation[row * terrain.width + column] = 300;
    }
    return { ...scenario, terrain: { ...terrain, elevation } };
  }
  const flat = (): typeof scenario => ({
    ...scenario,
    terrain: { ...scenario.terrain, elevation: new Float32Array(scenario.terrain.elevation.length).fill(20) },
  });

  it('hides a low aircraft behind a ridge, both ways, and not a high one', () => {
    const { terrain } = walled();
    const ground = { x: 1500, y: 2500 };
    const air = { x: 2600, y: 2500 };
    expect(hasAirLos(terrain, ground, air, 100)).toBe(false);
    expect(hasAirLos(terrain, ground, air, 1500)).toBe(true);
    expect(hasAirLos(flat().terrain, ground, air, 100)).toBe(true);
  });

  // An aircraft orbiting behind the wall from a team, with a certain-hit weapon.
  function behindWall(world: typeof scenario, altitude: number): SimState {
    const lethal = {
      ...world,
      file: {
        ...world.file,
        combat: {
          ...world.file.combat,
          weapons: { ...world.file.combat.weapons, MANPADS: { ...world.file.combat.weapons.MANPADS, airHitChance: 1 } },
        },
        air: { ...world.file.air, groundNoticePerScan: 1 },
      },
    };
    const state = createInitialState(lethal, 1);
    isolate(state, ['E-AD']);
    // It would otherwise walk back to its scenario position, across the ridge.
    const team = unit(state, 'E-AD');
    team.position = { x: 1800, y: 2500 };
    platoonOf(state.truth, team).objective = { kind: 'HoldArea', area: { center: team.position, radius: 60 } };
    const commands: PlayerCommand[] = [
      { kind: 'setAltitude', tick: 0, aircraftId: CAS, meters: altitude },
      { kind: 'setRisk', tick: 0, aircraftId: CAS, risk: 'pressOn' },
      hold(state, CAS), order(state, CAS, watch({ x: 2500, y: 2500 }, 100)),
    ];
    step(state, commands, lethal);
    for (let i = 0; i < 700 && !aircraft(state, CAS).damaged; i += 1) step(state, [], lethal);
    return state;
  }

  it('a ridge stops ground fire that open ground would not', () => {
    expect(aircraft(behindWall(flat(), 100), CAS).damaged).toBe(true);
    expect(aircraft(behindWall(walled(), 100), CAS).damaged).toBe(false);
  });

  it('terrain also blocks what the aircraft can see', () => {
    expect(Object.keys(behindWall(walled(), 100).player.contacts)).toEqual([]);
  });

  it('pilots keep clear of the terrain whatever the order says', () => {
    const state = createInitialState(scenario, 1);
    step(state, [{ kind: 'setAltitude', tick: 0, aircraftId: CAS, meters: 100 }, hold(state, CAS), order(state, CAS, watch(outpost, 500))], scenario);
    for (let i = 0; i < 500; i += 1) {
      step(state, [], scenario);
      const plane = aircraft(state, CAS);
      if (plane.status === 'onStation') {
        expect(plane.altitudeMeters).toBeGreaterThanOrEqual(elevationAt(scenario.terrain, plane.position) + 10);
      }
    }
    expect(aircraft(state, CAS).status).toBe('onStation');
  });

  it('a weapon on a hill reaches higher than the same weapon below it', () => {
    const { terrain } = scenario;
    expect(Math.max(...terrain.elevation)).toBeGreaterThanOrEqual(240);
  });

});

describe('aircraft models', () => {
  const JET = 'CAS-2' as AircraftId;
  const models = air.models;
  const need = (name: string) => {
    const model = models[name];
    if (model === undefined) throw new Error(`No model ${name}`);
    return model;
  };

  it('has real aircraft with distinct strengths', () => {
    const sky = need('A-1E');
    const sabre = need('F-100D');
    expect(sky.speedMps).toBeLessThan(sabre.speedMps);
    expect(sky.ammunition).toBeGreaterThan(sabre.ammunition);
    expect(sky.hitSurvivalChance).toBeGreaterThan(sabre.hitSurvivalChance);
    expect(sky.strikeMissPerMeterAltitude).toBeLessThan(sabre.strikeMissPerMeterAltitude);
    expect(sabre.casualtyFractionPerPass).toBeGreaterThan(sky.casualtyFractionPerPass);
    expect(sabre.hitChanceFactor).toBeLessThan(sky.hitChanceFactor);
  });

  it('a high-altitude recon type loses less to height than a low-level scout', () => {
    expect(need('RF-101C').sensorFalloffMeters).toBeGreaterThan(need('O-1E').sensorFalloffMeters);
  });

  it('tells the player which model each aircraft is', () => {
    const state = createInitialState(scenario, 1);
    const names = aircraftTelemetry(state.truth, air).map((a) => a.model);
    expect(names).toEqual(['A-1E Skyraider', 'F-100D Super Sabre', 'UH-1H Dustoff', 'UH-1B Huey gunship', 'O-1E Bird Dog']);
  });

  it('a spent aircraft with fuel left stays on station until ordered home', () => {
    const state = createInitialState(scenario, 1);
    isolate(state, ['F-A']);
    run(state, 500, [order(state, CAS, support(outpost))]);
    aircraft(state, CAS).ammunition = 0;
    run(state, 1000);
    expect(aircraft(state, CAS).status).toBe('onStation');
  });

  it('the automated players recall a spent aircraft', () => {
    const state = createInitialState(scenario, 1);
    const plane = aircraft(state, CAS);
    plane.status = 'onStation';
    plane.ammunition = 0;
    plane.gunBursts = 0;
    const view = project(state.player, aircraftTelemetry(state.truth, air), 0, scenario.file.display);
    expect(reconInformed(outpost, true)(view)).toContainEqual({
      kind: 'aircraftOrder',
      tick: 0,
      aircraftId: CAS,
      order: { kind: 'ReturnToBase' },
    });
  });

  function hitsOn(model: string, seeds: number): Readonly<{ hits: number; damaged: number }> {
    const certain = {
      ...scenario,
      file: {
        ...scenario.file,
        air: { ...air, models: { ...air.models, [model]: { ...need(model), hitChanceFactor: 1e6 } } },
      },
    };
    let hits = 0;
    let damaged = 0;
    for (let seed = 0; seed < seeds; seed += 1) {
      const state = createInitialState(certain, seed);
      isolate(state, ['E-AD']);
      const id = model === 'A-1E' ? CAS : JET;
      step(state, [order(state, id, support(unit(state, 'E-AD').position))], certain);
      for (let i = 0; i < 700 && !aircraft(state, id).damaged; i += 1) step(state, [], certain);
      for (const message of state.player.log) {
        if (message.kind !== 'GROUND_FIRE' || !message.hit) continue;
        hits += 1;
        if (message.damaged) damaged += 1;
      }
    }
    return { hits, damaged };
  }

  it('a rugged airframe survives some hits that would end another\'s mission', () => {
    const sky = hitsOn('A-1E', 10);
    const sabre = hitsOn('F-100D', 10);
    expect(sky.hits).toBeGreaterThan(sky.damaged);
    expect(sky.damaged / sky.hits).toBeLessThan(sabre.damaged / sabre.hits);
  });
});

describe('helicopters', () => {
  const GUNSHIP = 'GUNSHIP-1' as AircraftId;

  it('holds position on station instead of orbiting', () => {
    const state = createInitialState(scenario, 1);
    isolate(state, ['F-A']);
    run(state, 800, [order(state, GUNSHIP, support(outpost))]);
    const helicopter = aircraft(state, GUNSHIP);
    expect(helicopter.status).toBe('onStation');
    const held = helicopter.position;
    run(state, 60);
    expect(helicopter.position).toEqual(held);
    expect(distance(held, outpost)).toBeLessThanOrEqual(120);
  });

  it('burns fuel while hovering', () => {
    const state = createInitialState(scenario, 1);
    isolate(state, ['F-A']);
    run(state, 800, [order(state, GUNSHIP, support(outpost))]);
    const before = aircraft(state, GUNSHIP).fuelSeconds;
    run(state, 60);
    expect(aircraft(state, GUNSHIP).fuelSeconds).toBe(before - 60);
  });

  it('flies closer to the ground than a jet can', () => {
    const state = createInitialState(scenario, 1);
    const commands: PlayerCommand[] = [
      { kind: 'setAltitude', tick: 0, aircraftId: GUNSHIP, meters: 30 },
      { kind: 'setAltitude', tick: 0, aircraftId: CAS, meters: 30 },
      hold(state, GUNSHIP), order(state, GUNSHIP, watch(outpost)),
      hold(state, CAS), order(state, CAS, watch(outpost)),
    ];
    step(state, commands, scenario);
    for (let i = 0; i < 900; i += 1) step(state, [], scenario);
    const clearance = (id: AircraftId): number =>
      aircraft(state, id).altitudeMeters - elevationAt(scenario.terrain, aircraft(state, id).position);
    expect(clearance(GUNSHIP)).toBeLessThan(clearance(CAS));
    expect(clearance(GUNSHIP)).toBeGreaterThan(0);
  });

  it('attacks through the normal CAS rules', () => {
    const state = createInitialState(scenario, 1);
    isolate(state, ['E-W']);
    run(state, 1100, [order(state, GUNSHIP, support(unit(state, 'E-W').position))]);
    const model = air.models['UH-1B']!;
    const plane = aircraft(state, GUNSHIP);
    expect(plane.ammunition + plane.gunBursts).toBeLessThan(model.ammunition + model.gunBursts);
  });

  it('tells the UI it is a helicopter, for its map symbol', () => {
    const state = createInitialState(scenario, 1);
    const entry = aircraftTelemetry(state.truth, air).find((a) => a.aircraftId === GUNSHIP);
    expect(entry?.rotary).toBe(true);
  });
});

describe('weather in play', () => {
  const overcast = (ceilingMeters: number): Weather => ({
    baseCeilingMeters: ceilingMeters,
    systems: [],
    rampSeconds: 300,
    clearVisibilityMeters: 8000,
    heavyRainVisibilityMeters: 300,
    cloudFadeMeters: 200,
    sky: DAY_SKY,
    rainMissMeters: 80,
  });

  function strikesUnder(ceilingMeters: number, manual: boolean): number {
    let strikes = 0;
    for (let seed = 0; seed < 5; seed += 1) {
      const state = createInitialState(scenario, seed);
      state.truth.weather = overcast(ceilingMeters);
      isolate(state, ['E-W']);
      const held = manual ? [{ kind: 'setAltitude', tick: 0, aircraftId: CAS, meters: 650 } as const] : [];
      run(state, 1000, [...held, order(state, CAS, support(unit(state, 'E-W').position))]);
      strikes += state.player.log.filter((m) => m.kind === 'STRIKE_RESULT').length;
    }
    return strikes;
  }

  it('an aircraft held above the cloud can neither see nor strike', () => {
    expect(strikesUnder(300, true)).toBe(0);
    expect(strikesUnder(5000, true)).toBeGreaterThan(0);
  });

  it('a crew left to itself comes down under the cloud to work', () => {
    expect(strikesUnder(300, false)).toBeGreaterThan(0);
  });

  it('telemetry says when an aircraft is above cloud', () => {
    const state = createInitialState(scenario, 1);
    state.truth.weather = overcast(300);
    run(state, 400, [hold(state, CAS), order(state, CAS, watch(outpost))]);
    const entry = aircraftTelemetry(state.truth, air, state.tick).find((a) => a.aircraftId === CAS);
    expect(entry?.aboveCloud).toBe(true);
  });

  it('forecasts arrive on schedule, as updates in the log', () => {
    const state = createInitialState(scenario, 1);
    const interval = scenario.file.weather.forecastIntervalSeconds;
    run(state, interval + 1);
    expect(state.player.forecastIssuedAt).toBe(interval);
    expect(state.player.log.filter((m) => m.kind === 'COMMAND_UPDATE' && m.text.includes('forecast'))).toHaveLength(2);
  });

  it('the view holds the forecast, not the true weather', () => {
    const state = createInitialState(scenario, 1);
    run(state, 2);
    const view = project(state.player, aircraftTelemetry(state.truth, air, state.tick), state.tick, scenario.file.display);
    expect(view.forecast).not.toEqual(state.truth.weather);
    expect(view.forecast).not.toBeNull();
  });

  it('the same seed gives the same weather and forecast', () => {
    const first = createInitialState(scenario, 8);
    const second = createInitialState(scenario, 8);
    run(first, 50);
    run(second, 50);
    expect(second.truth.weather).toEqual(first.truth.weather);
    expect(second.player.forecast).toEqual(first.player.forecast);
  });
});

describe('fire missions and weapons control', () => {
  // An enemy squad far from any friendly, held still, with CAS sent over it.
  function overEnemy(task: (state: SimState, at: Vec2) => readonly PlayerCommand[], seed = 3) {
    const state = createInitialState(scenario, seed);
    isolate(state, ['F-A', 'E-N1']);
    const enemy = unit(state, 'E-N1');
    platoonOf(state.truth, enemy).activeFromTick = 100000;
    enemy.position = { x: 2525, y: 1700 };
    run(state, 1, task(state, enemy.position));
    return { state, enemy, plane: aircraft(state, CAS) };
  }

  it('holds its own fire on weapons hold, over a confirmed enemy', () => {
    const { state, plane, enemy } = overEnemy((state, at) => [hold(state, CAS), order(state, CAS, support(at))]);
    run(state, 1500);
    expect(Object.values(plane.contacts).some((c) => c.identification === 'hostile')).toBe(true);
    expect(plane.ammunition + plane.gunBursts).toBe(air.models['A-1E']!.ammunition + air.models['A-1E']!.gunBursts);
    expect(enemy.personnel).toBe(enemy.initialPersonnel);
    expect(aircraftTelemetry(state.truth, air, state.tick).find((a) => a.aircraftId === CAS)?.casPhase).toBe('weapons-hold');
  });

  it('suppresses a place with guns, without a target of its own, then watches it', () => {
    const until = 1500;
    const { state, plane } = overEnemy((state, at) => [hold(state, CAS), order(state, CAS, { kind: 'Suppress', center: at, radius: 150, untilTick: until })]);
    run(state, until + 200);
    const passes = state.player.log.flatMap((m) => (m.kind === 'STRIKE_RESULT' ? [m] : []));
    expect(passes.length).toBeGreaterThan(0);
    expect(passes.every((m) => m.contact === null)).toBe(true);
    expect(plane.ammunition).toBe(air.models['A-1E']!.ammunition);
    expect(plane.order?.kind).toBe('Watch');
  });

  it('spreads its bursts over the window rather than spending them at once', () => {
    const { state, plane } = overEnemy((state, at) => [order(state, CAS, { kind: 'Suppress', center: at, radius: 150, untilTick: 4000 })]);
    run(state, 1500);
    expect(plane.gunBursts).toBeGreaterThan(0);
    expect(plane.order?.kind).toBe('Suppress');
  });

  it('flies one heavy pass on a strike, then watches the place', () => {
    const { state, plane } = overEnemy((state, at) => [hold(state, CAS), order(state, CAS, { kind: 'Strike', center: at, radius: 300 })]);
    run(state, 1500);
    expect(plane.ammunition).toBe(air.models['A-1E']!.ammunition - 1);
    expect(plane.order?.kind).toBe('Watch');
  });

  it('keeps suppressive fire off friendlies on the map, whatever the order says', () => {
    const state = createInitialState(scenario, 3);
    isolate(state, ['F-A']);
    const friendly = unit(state, 'F-A');
    updateFriendly(state.player, 'F-A', { center: friendly.position, sigmaMeters: 10, headingRad: null, speedMps: null, observedAt: 0 }, 'self-report', 0, 100000);
    run(state, 1, [order(state, CAS, { kind: 'Suppress', center: friendly.position, radius: 100, untilTick: 2000 })]);
    run(state, 1500);
    expect(aircraft(state, CAS).gunBursts).toBe(air.models['A-1E']!.gunBursts);
    expect(friendly.personnel).toBe(friendly.initialPersonnel);
  });

  it('tells the platoons when and where, and calls it off when the aircraft is given something else', () => {
    const state = createInitialState(scenario, 3);
    const center = { x: 2525, y: 1200 };
    run(state, 1, [order(state, CAS, { kind: 'Suppress', center, radius: 150, untilTick: 2000 })]);
    run(state, radioConfig.transmitSeconds + 1);
    const heard = state.unitKnowledge['F-A']?.suppressions[CAS];
    expect(heard?.center).toEqual(center);
    expect(heard?.untilTick).toBe(2000);
    expect(heard?.fromTick).toBeGreaterThan(1);
    run(state, 1, [order(state, CAS, support(outpost))]);
    run(state, radioConfig.transmitSeconds + 1);
    expect(state.unitKnowledge['F-A']?.suppressions[CAS]).toBeUndefined();
  });

  it('covers a platoon by following it on the controller\'s map', () => {
    const state = createInitialState(scenario, 3);
    isolate(state, ['F-A']);
    const friendly = unit(state, 'F-A');
    const start = { ...friendly.position };
    run(state, 1, [order(state, CAS, { kind: 'Cover', unitId: 'F-A', center: start, radius: 500 })]);
    // The platoon moves off: the map learns it from reports and sightings, and the aircraft follows the map.
    friendly.position = { x: 2000, y: 2000 };
    run(state, 600);
    const mapped = state.player.friendlies['F-A']?.position;
    const cover = aircraft(state, CAS).order;
    if (mapped === undefined || cover === null || cover.kind !== 'Cover') throw new Error('No cover');
    const ahead = mapped.headingRad === null ? 0 : air.coverAheadMeters;
    expect(cover.center.x).toBeCloseTo(mapped.center.x + Math.cos(mapped.headingRad ?? 0) * ahead, 6);
    expect(cover.center.y).toBeCloseTo(mapped.center.y + Math.sin(mapped.headingRad ?? 0) * ahead, 6);
    expect(distance(cover.center, start)).toBeGreaterThan(300);
  });
});

describe('crew calls', () => {
  it('calls JOKER, then BINGO, once each, before heading home on fuel', () => {
    const state = createInitialState(scenario, 3);
    isolate(state, ['F-A', 'E-N1']);
    platoonOf(state.truth, unit(state, 'E-N1')).activeFromTick = 100000;
    const plane = aircraft(state, CAS);
    run(state, 1, [hold(state, CAS), order(state, CAS, watch(outpost))]);
    run(state, 400);
    // Short of fuel, so the calls come within the battle.
    const model = air.models['A-1E']!;
    const home = distance(plane.position, air.airbase) / model.speedMps;
    plane.fuelSeconds = home + model.bingoMarginSeconds + air.jokerSeconds + 60;
    for (let i = 0; i < 3000 && plane.status !== 'returning'; i += 1) step(state, [], scenario);
    run(state, 10);
    const calls = state.player.log.flatMap((m) => (m.kind === 'CREW_CALL' && m.senderId === CAS ? [m.call] : []));
    expect(calls).toEqual(['JOKER', 'BINGO']);
  });

  it('says when the bombs are gone, and WINCHESTER when everything is', () => {
    const state = createInitialState(scenario, 3);
    const plane = aircraft(state, CAS);
    run(state, 1, [hold(state, CAS), order(state, CAS, watch(outpost))]);
    run(state, 400);
    plane.ammunition = 0;
    run(state, 10);
    plane.gunBursts = 0;
    run(state, 10);
    const calls = state.player.log.flatMap((m) => (m.kind === 'CREW_CALL' && m.senderId === CAS ? [m.call] : []));
    expect(calls).toEqual(['BOMBS_EXPENDED', 'WINCHESTER']);
  });
});

describe('smoke marks', () => {
  function expectingAir(): SimState {
    const state = createInitialState(scenario, 3);
    isolate(state, ['F-A', 'E-N1']);
    const enemy = unit(state, 'E-N1');
    platoonOf(state.truth, enemy).activeFromTick = 100000;
    enemy.position = { x: 2525, y: 2350 };
    const belief = (state.unitKnowledge['F-A'] ??= emptyKnowledge());
    belief.expectedSupport = { aircraftId: CAS, etaAt: 0, lapsesAt: 100000 };
    return state;
  }

  it('marks the enemy it knows of once air is due, and the enemy sees the smoke', () => {
    const state = expectingAir();
    run(state, 300);
    expect(platoonOf(state.truth, unit(state, 'F-A')).lastMarkAt).toBeDefined();
    expect(state.unitKnowledge['E-N1']?.hostileAircraftSeenAt).not.toBeNull();
  });

  it('marks nothing without air due, or without an enemy in reach', () => {
    const quiet = createInitialState(scenario, 3);
    isolate(quiet, ['F-A', 'E-N1']);
    platoonOf(quiet.truth, unit(quiet, 'E-N1')).activeFromTick = 100000;
    unit(quiet, 'E-N1').position = { x: 2525, y: 2350 };
    run(quiet, 300);
    expect(platoonOf(quiet.truth, unit(quiet, 'F-A')).lastMarkAt).toBeUndefined();
    const far = expectingAir();
    unit(far, 'E-N1').position = { x: 2525, y: 1000 };
    run(far, 300);
    expect(platoonOf(far.truth, unit(far, 'F-A')).lastMarkAt).toBeUndefined();
  });

  it('shows on the controller\'s map once a crew overhead sees it', () => {
    const state = expectingAir();
    run(state, 1, [hold(state, CAS), order(state, CAS, watch(outpost, 500))]);
    run(state, 600);
    expect(state.player.smoke.length).toBeGreaterThan(0);
  });
});

describe('answers to support requests', () => {
  function requested(state: SimState): void {
    receiveByPlayer(state.player, {
      id: 'M-900' as never,
      senderId: 'F-A',
      observedAt: state.tick,
      sentAt: state.tick,
      receivedAt: state.tick,
      kind: 'SUPPORT_REQUEST',
      ownPosition: { center: unit(state, 'F-A').position, sigmaMeters: 20, headingRad: null, speedMps: null, observedAt: state.tick },
      dangerClose: true,
      wants: 'both',
      target: null,
      targetStrength: null,
      marked: false,
    }, 120);
  }

  it('records the promise when an aircraft is sent and acknowledged in one go', () => {
    const state = createInitialState(scenario, 3);
    requested(state);
    run(state, 1, [order(state, CAS, support(unit(state, 'F-A').position)), { kind: 'acknowledge', tick: state.tick, unitId: 'F-A', casAircraftId: CAS }]);
    expect(state.player.supportRequests['F-A']?.answer).toMatchObject({ kind: 'inbound', aircraftId: CAS });
  });

  it('records that the promise was called off when the aircraft is given something else', () => {
    const state = createInitialState(scenario, 3);
    requested(state);
    run(state, 1, [order(state, CAS, support(unit(state, 'F-A').position)), { kind: 'acknowledge', tick: state.tick, unitId: 'F-A', casAircraftId: CAS }]);
    run(state, 10, [order(state, CAS, support({ x: 100, y: 100 }))]);
    expect(state.player.supportRequests['F-A']?.answer?.kind).toBe('cancelled');
  });

  it('clears danger close on approval and revokes it on a later denial', () => {
    const state = createInitialState(scenario, 3);
    requested(state);
    run(state, 1, [{ kind: 'answerDangerClose', tick: state.tick, unitId: 'F-A', approved: true }]);
    expect(state.player.dangerCloseClearedUntil['F-A']).toBeGreaterThan(state.tick);
    run(state, 1, [{ kind: 'answerDangerClose', tick: state.tick, unitId: 'F-A', approved: false }]);
    expect(state.player.dangerCloseClearedUntil['F-A']).toBeUndefined();
  });
});

describe('night and flares', () => {
  const night = loadScenarioFile('outpost-night');
  const runNight = (state: SimState, ticks: number, commands: readonly PlayerCommand[] = []): void => {
    step(state, commands, night);
    for (let i = 1; i < ticks && state.truth.outcome === 'running'; i += 1) step(state, [], night);
  };

  it('keeps a flare burning over the area for as long as asked, then watches it', () => {
    const state = createInitialState(night, 3);
    const recon = state.truth.aircraft.find((a) => a.id === RECON) as Aircraft;
    const until = 900;
    runNight(state, 1, [{ kind: 'aircraftOrder', tick: 0, aircraftId: RECON, order: { kind: 'Illuminate', center: outpost, radius: 500, untilTick: until } }]);
    for (let i = 0; i < 3000 && recon.status !== 'onStation'; i += 1) step(state, [], night);
    runNight(state, 5);
    expect(state.player.flares.some((flare) => flare.by === RECON)).toBe(true);
    expect(state.truth.flares.some((flare) => flare.by === RECON && distance(flare.position, outpost) < 1)).toBe(true);
    expect(recon.flares).toBeLessThan(night.file.air.models['O-1E']!.flares);
    runNight(state, Math.max(10, until - state.tick + 10));
    expect(recon.order?.kind).toBe('Watch');
  });

  it('refuses to illuminate with an aircraft that carries no flares', () => {
    const state = createInitialState(night, 3);
    const jet = state.truth.aircraft.find((a) => a.model === 'F-100D');
    if (jet === undefined) return;
    runNight(state, 1, [{ kind: 'aircraftOrder', tick: 0, aircraftId: jet.id, order: { kind: 'Illuminate', center: outpost, radius: 500, untilTick: 900 } }]);
    expect(jet.status).toBe('ready');
  });

  it('has platoons fire illumination over the enemy they know of in the dark', () => {
    const state = createInitialState(night, 3);
    runNight(state, 3600);
    const fired = Object.values(state.truth.platoons).some((platoon) => (platoon.illuminationFired ?? 0) > 0);
    expect(fired).toBe(true);
  });

  it('sees less of a unit at night than by day, unless it is firing', () => {
    const dark = createInitialState(night, 3);
    const light = createInitialState(scenario, 3);
    const enemy = (state: SimState) => state.truth.units.find((u) => u.side === 'enemy') as GroundUnit;
    expect(sightOn(light.truth, enemy(light), 0)).toBe(1);
    expect(sightOn(dark.truth, enemy(dark), 0)).toBeLessThan(0.5);
    enemy(dark).lastFiredAtTick = 0;
    expect(sightOn(dark.truth, enemy(dark), 0)).toBeGreaterThanOrEqual(0.6);
  });
});
