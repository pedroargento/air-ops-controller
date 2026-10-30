import { describe, expect, it } from 'vitest';
import { firstDivergence, runReplay } from '../../src/cli/replay';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import type { AircraftId, AircraftOrder } from '../../src/domain/public/air';
import type { PlayerCommand } from '../../src/domain/public/commands';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import { distance, type Vec2 } from '../../src/domain/public/geometry';
import type { ContactId } from '../../src/domain/public/ground';
import type { Aircraft, GroundUnit } from '../../src/domain/truth/world';
import { updateContact, updateFriendly } from '../../src/knowledge/player-knowledge';
import { aircraftTelemetry } from '../../src/sim/air';
import { createInitialState, type SimState } from '../../src/sim/state';
import { step } from '../../src/sim/step';

const scenario = loadScenarioFile();
const { air, capture, radio: radioConfig } = scenario.file;
const CAS = 'CAS-1' as AircraftId;
const RECON = 'RECON-1' as AircraftId;
const outpost = capture.area.center;

function aircraft(state: SimState, id: AircraftId): Aircraft {
  const found = state.truth.aircraft.find((a) => a.id === id);
  if (found === undefined) throw new Error(`No aircraft ${id}`);
  return found;
}

function unit(state: SimState, id: string): GroundUnit {
  const found = state.truth.units.find((u) => u.id === id);
  if (found === undefined) throw new Error(`No unit ${id}`);
  return found;
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
  state.truth.units = state.truth.units.filter((u) => keep.includes(u.id));
}

const support = (center: Vec2, radius = 500): AircraftOrder => ({ kind: 'SupportArea', center, radius });

describe('aircraft operations', () => {
  it('needs takeoff and travel time to reach the area', () => {
    const state = createInitialState(scenario, 1);
    run(state, 60, [order(state, CAS, { kind: 'MoveTo', point: outpost })]);
    expect(aircraft(state, CAS).status).not.toBe('onStation');
    run(state, 400);
    expect(aircraft(state, CAS).status).toBe('onStation');
  });

  it('transit takes about four to six minutes for both types', () => {
    const state = createInitialState(scenario, 1);
    const eta = (id: AircraftId): number => {
      step(state, [order(state, id, { kind: 'MoveTo', point: outpost })], scenario);
      return aircraftTelemetry(state.truth, air).find((a) => a.aircraftId === id)?.etaSeconds ?? 0;
    };
    for (const id of [CAS, RECON]) {
      expect(eta(id)).toBeGreaterThanOrEqual(4 * 60);
      expect(eta(id)).toBeLessThanOrEqual(6.5 * 60);
    }
  });

  it('returns automatically before fuel runs out, then rearms after turnaround', () => {
    const state = createInitialState(scenario, 1);
    isolate(state, ['F-A']);
    run(state, 1, [order(state, CAS, support(outpost))]);
    const a = aircraft(state, CAS);
    a.ammunition = 0;
    let landedWithFuel = -1;
    for (let tick = 0; tick < 4000 && a.status !== 'turnaround'; tick += 1) {
      step(state, [], scenario);
      landedWithFuel = a.fuelSeconds;
    }
    expect(a.status).toBe('turnaround');
    expect(landedWithFuel).toBeGreaterThan(0);
    run(state, air.types.cas.turnaroundSeconds + 1);
    expect(a.status).toBe('ready');
    expect(a.ammunition).toBe(air.types.cas.ammunition);
    expect(a.fuelSeconds).toBe(air.types.cas.fuelSeconds);
  });

  it('flies continuously: no jumps, and turns no faster than its turn rate', () => {
    const state = createInitialState(scenario, 1);
    isolate(state, ['F-A']);
    run(state, 1, [order(state, CAS, support(outpost))]);
    const a = aircraft(state, CAS);
    const type = air.types.cas;
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
    expect(Math.max(...gaps)).toBeLessThan(air.types.cas.orbitRadiusMeters * 1.3);
    expect(Math.min(...gaps)).toBeGreaterThan(air.types.cas.orbitRadiusMeters * 0.7);
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

  it('only CAS can take a support mission', () => {
    const state = createInitialState(scenario, 1);
    run(state, 1, [order(state, RECON, support(outpost))]);
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
    enemy.activeFromTick = 100000;
    enemy.position = { x: 2525, y: 1850 };
    run(state, 1, [order(state, RECON, { kind: 'ReconArea', center: enemy.position, radius: 500 })]);
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
    enemy.activeFromTick = 100000;
    enemy.position = enemyAt;
    run(state, 1, [order(state, CAS, support(areaCenter))]);
    return { state, enemy, plane: aircraft(state, CAS) };
  }

  it('spends nothing when the area holds no target, however long it orbits', () => {
    const { state, plane, enemy } = casRun({ x: 2525, y: 1000 }, { x: 4500, y: 4500 });
    run(state, 1000);
    expect(plane.ammunition).toBe(air.types.cas.ammunition);
    expect(enemy.personnel).toBe(enemy.initialPersonnel);
  });

  it('attacks a real target in discrete passes through shared combat state', () => {
    const { state, plane, enemy } = casRun({ x: 2525, y: 1700 }, { x: 2525, y: 1700 });
    run(state, 1000);
    expect(plane.ammunition).toBeLessThan(air.types.cas.ammunition);
    expect(enemy.personnel).toBeLessThan(enemy.initialPersonnel);
    const strikes = state.player.log.filter((m) => m.kind === 'STRIKE_RESULT');
    expect(strikes).toHaveLength(air.types.cas.ammunition - plane.ammunition);
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
    expect(aircraft(state, CAS).ammunition).toBe(air.types.cas.ammunition);
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
    expect(plane.ammunition).toBe(air.types.cas.ammunition);
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
