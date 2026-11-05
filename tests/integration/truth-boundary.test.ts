import { emptyKnowledge } from '../../src/domain/public/ground';
import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import type { AircraftId } from '../../src/domain/public/air';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import type { ContactId } from '../../src/domain/public/ground';
import { observeTarget } from '../../src/perception/observe';
import { createRng } from '../../src/rng/streams';
import { resolveCas, updateAircraftNotice } from '../../src/sim/air';
import { createInitialState, type SimState } from '../../src/sim/state';
import { step } from '../../src/sim/step';

const valley = loadScenarioFile('valley-road');
const { air, combat, display, perception } = valley.file;
const flat = { ...valley.terrain, elevation: new Float32Array(valley.terrain.elevation.length) };

const estimate = (x: number, y: number): ContactEstimate => ({
  contactId: 'C-1' as ContactId,
  provenance: { sourceId: 'CAS-1', observedAt: 0 },
  identification: 'hostile',
  position: { center: { x, y }, sigmaMeters: 30, headingRad: null, speedMps: null, observedAt: 0 },
  strength: { kind: 'range', min: 15, max: 50 },
  kind: 'infantry',
  activity: 'stationary',
  confidence: 'high',
  observedWeapons: [],
});

function onStation(state: SimState, contact: ContactEstimate) {
  const plane = state.truth.aircraft.find((aircraft) => aircraft.id === ('CAS-1' as AircraftId));
  if (plane === undefined) throw new Error('No aircraft');
  plane.status = 'onStation';
  plane.position = contact.position.center;
  plane.altitudeMeters = 300;
  plane.order = { kind: 'Watch', center: contact.position.center, radius: 400 };
  plane.contacts['C-1'] = contact;
  plane.gunBursts = 0;
  return plane;
}

/** Starts the run, then releases: the aircraft is already over its aiming point. */
const strike = (state: SimState): void => {
  for (let call = 0; call < 2; call += 1) {
    resolveCas(state.truth, state.player, state.radio, flat, air, combat, display, perception.engageMemorySeconds, state.rng, 0);
  }
  for (const plane of state.truth.aircraft) plane.attackRun = null;
};

const enemyMen = (state: SimState): number =>
  state.truth.units.filter((unit) => unit.side === 'enemy').reduce((sum, unit) => sum + unit.personnel, 0);

describe('strikes decide on the estimate', () => {
  it('spends the pass on an estimate with nobody there', () => {
    const state = createInitialState(valley, 1);
    const plane = onStation(state, estimate(500, 500));
    const [ordnance, men] = [plane.ammunition, enemyMen(state)];
    strike(state);
    expect(plane.ammunition).toBe(ordnance - 1);
    expect(enemyMen(state)).toBe(men);
    expect(state.player.log.find((message) => message.kind === 'STRIKE_RESULT')).toMatchObject({ effect: 'no-effect-observed' });
  });

  it('commits even if the enemy it saw is already dead', () => {
    const state = createInitialState(valley, 1);
    for (const unit of state.truth.units) if (unit.side === 'enemy') unit.personnel = 0;
    const plane = onStation(state, estimate(1925, 2325));
    const ordnance = plane.ammunition;
    strike(state);
    expect(plane.ammunition).toBe(ordnance - 1);
  });

  it('hits who is really there when the estimate is good', () => {
    const state = createInitialState(valley, 3);
    const squad = state.truth.platoons['E-A1']?.squads[0];
    if (squad === undefined) throw new Error('No squad');
    const plane = onStation(state, estimate(squad.position.x, squad.position.y));
    const men = enemyMen(state);
    for (let pass = 0; pass < 6; pass += 1) {
      plane.nextPassTick = 0;
      strike(state);
    }
    expect(enemyMen(state)).toBeLessThan(men);
  });

});

describe('friendly fire and danger close', () => {
  const marked = (state: SimState, unitId: string, x: number, y: number): void => {
    state.player.friendlies[unitId] = {
      unitId,
      position: { center: { x, y }, sigmaMeters: 30, headingRad: null, speedMps: null, observedAt: 0 },
      source: 'self-report',
      receivedAt: 0,
    };
  };
  const setup = () => {
    const state = createInitialState(valley, 3);
    const friendly = state.truth.platoons['F-C1']?.squads[0];
    if (friendly === undefined) throw new Error('No squad');
    friendly.position = { x: 1500, y: 3000 };
    const plane = onStation(state, estimate(1500, 3000));
    return { state, friendly, plane };
  };

  it('hits friends the map doesn\'t show there', () => {
    const { state, friendly, plane } = setup();
    marked(state, 'F-C1', 3500, 500);
    marked(state, 'F-C2', 3500, 500);
    const men = friendly.personnel;
    for (let pass = 0; pass < 8; pass += 1) {
      plane.nextPassTick = 0;
      strike(state);
    }
    expect(friendly.personnel).toBeLessThan(men);
    expect(state.truth.friendlyFireCasualties).toBe(men - friendly.personnel);
  });

  it('holds off a friendly marker, and says so', () => {
    const { state, friendly, plane } = setup();
    marked(state, 'F-C1', 1550, 3000);
    const [men, ordnance] = [friendly.personnel, plane.ammunition];
    strike(state);
    expect(friendly.personnel).toBe(men);
    expect(plane.ammunition).toBe(ordnance);
    expect(state.player.log.some((message) => message.kind === 'DANGER_CLOSE_HOLD')).toBe(true);
  });

  it('takes another target rather than hold if it has one', () => {
    const { state, plane } = setup();
    marked(state, 'F-C1', 1550, 3000);
    plane.order = { kind: 'Watch', center: { x: 1500, y: 3000 }, radius: 800 };
    plane.contacts['C-2'] = { ...estimate(1500, 2500), contactId: 'C-2' as ContactId };
    const ordnance = plane.ammunition;
    strike(state);
    expect(plane.ammunition).toBe(ordnance - 1);
  });

  const asked = (state: SimState): void => {
    state.player.supportRequests['F-C1'] = {
      unitId: 'F-C1',
      position: { center: { x: 1550, y: 3000 }, sigmaMeters: 30, headingRad: null, speedMps: null, observedAt: 0 },
      receivedAt: 0,
      acknowledged: false,
      dangerClose: true,
      wants: 'guns',
      target: null,
      targetStrength: null,
      marked: false,
      answer: null,
    };
  };

  it('releases once the controller clears the unit that asked, for a limited time', () => {
    const { state, plane } = setup();
    marked(state, 'F-C1', 1550, 3000);
    asked(state);
    step(state, [{ kind: 'answerDangerClose', tick: 0, unitId: 'F-C1', approved: true }], valley);
    const until = state.player.dangerCloseClearedUntil['F-C1'];
    expect(until).toBe(state.tick - 1 + air.dangerCloseClearanceSeconds);
    plane.status = 'onStation';
    plane.nextPassTick = 0;
    plane.contacts['C-1'] = estimate(1500, 3000);
    const ordnance = plane.ammunition;
    strike(state);
    expect(plane.ammunition).toBe(ordnance - 1);
  });

  it('can\'t be cleared unless the unit asked, and a denial clears nothing', () => {
    const { state } = setup();
    step(state, [{ kind: 'answerDangerClose', tick: 0, unitId: 'F-C1', approved: true }], valley);
    expect(state.player.dangerCloseClearedUntil['F-C1']).toBeUndefined();
    asked(state);
    step(state, [{ kind: 'answerDangerClose', tick: 1, unitId: 'F-C1', approved: false }], valley);
    expect(state.player.dangerCloseClearedUntil['F-C1']).toBeUndefined();
    expect(state.player.supportRequests['F-C1']?.dangerClose).toBe(false);
  });

  it('a unit hit by its own side calls check fire', () => {
    const { state, plane } = setup();
    marked(state, 'F-C1', 3500, 500);
    marked(state, 'F-C2', 3500, 500);
    plane.nextPassTick = 0;
    strike(state);
    expect(state.radio.units['F-C1']?.queue.some((task) => task.need.kind === 'CHECK_FIRE')).toBe(true);
  });

  it('crews sometimes take friends for hostile, and never the reverse', () => {
    const sure = { ...perception, misidentifyChance: 1, identifyPerScan: 1 };
    const seenAs = (side: 'friendly' | 'enemy'): readonly string[] =>
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
        const state = createInitialState(valley, seed);
        const target = state.truth.units.find((unit) => unit.side === side);
        if (target === undefined) throw new Error('No squad');
        const observer = {
          id: 'CAS-1', side: 'friendly', position: { x: target.position.x + 300, y: target.position.y }, medium: 'air', sees: () => true,
          rangeTo: () => 500, quality: 1, rangeMeters: 500, suppression: 0, detectionBoost: () => 1000,
        } as const;
        return observeTarget(state.truth, observer, target, flat, createRng(seed), sure, 5)?.identification ?? 'none';
      });
    expect(seenAs('friendly')).toContain('hostile');
    expect(seenAs('enemy').every((id) => id !== 'friendly')).toBe(true);
  });
});

describe('forwarded reports', () => {
  it('carry the crew\'s estimate unchanged, wrong as it may be', () => {
    const state = createInitialState(valley, 1);
    const wrong = estimate(500, 500);
    state.player.contacts['CAS-1/C-1'] = { contact: wrong, viaAircraft: true, status: 'active', statusAt: 0, clearLookSeconds: 0, estimatedLosses: 0 } as never;
    step(state, [{ kind: 'forwardContact', tick: 0, contactKey: 'CAS-1/C-1', recipients: ['F-C1'] }], valley);
    for (let i = 0; i < valley.file.radio.transmitSeconds + 2; i += 1) step(state, [], valley);
    const [received] = Object.values(state.unitKnowledge['F-C1']?.reports ?? {});
    expect(received).toEqual(wrong);
    const nearest = Math.min(...state.truth.units.filter((u) => u.side === 'enemy').map((u) => Math.hypot(u.position.x - 500, u.position.y - 500)));
    expect(nearest).toBeGreaterThan(1000);
  });

  it('can start a drill on a position nobody is at', () => {
    const state = createInitialState(valley, 1);
    const squad = state.truth.platoons['F-C1']?.squads[0];
    if (squad === undefined) throw new Error('No squad');
    while (squad.route.length < 12) step(state, [], valley);
    const ahead = squad.route[8] as { x: number; y: number };
    const wrong = estimate(ahead.x, ahead.y);
    (state.unitKnowledge['F-C1'] ??= emptyKnowledge()).reports['CAS-1/C-1'] = {
      ...wrong,
      position: { ...wrong.position, observedAt: state.tick },
    };
    for (let i = 0; i < 6; i += 1) step(state, [], valley);
    expect(state.truth.platoons['F-C1']?.drill?.target).toEqual(ahead);
  });
});

describe('ground units and aircraft', () => {
  it('judge where an aircraft is by eye', () => {
    const state = createInitialState(valley, 1);
    const plane = state.truth.aircraft[0];
    const [unit] = state.truth.units.filter((u) => u.side === 'enemy');
    if (plane === undefined || unit === undefined) throw new Error('Expected units');
    plane.status = 'onStation';
    plane.position = { ...unit.position };
    plane.altitudeMeters = 300;
    const sure = { ...air, groundNoticePerScan: 1 };
    updateAircraftNotice(state.truth, state.unitKnowledge, sure, flat, state.rng, 0);
    const noticed = state.unitKnowledge[unit.platoonId]?.noticedAircraft;
    expect(noticed).not.toBeNull();
    expect(noticed?.position).not.toEqual(plane.position);
  });
});
