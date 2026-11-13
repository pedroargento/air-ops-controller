import { describe, expect, it } from 'vitest';
import { decideGround, decidePlatoon } from '../../src/ai/decide-ground';
import { assignRoles } from '../../src/ai/drills';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import { distance } from '../../src/domain/public/geometry';
import { emptyKnowledge, type ContactId, type DrillMap, type UnitId, type UnitSelf } from '../../src/domain/public/ground';
import type { RadioMessage, ReportNeed } from '../../src/domain/public/radio';
import { emptyPlayerKnowledge, receiveByPlayer } from '../../src/knowledge/player-knowledge';
import { project } from '../../src/knowledge/player-view';
import { markingKillZones, type Policy } from '../../src/policies/air-policies';
import { totalAmmunition } from '../../src/domain/public/equipment';
import { createRng } from '../../src/rng/streams';
import { resolveCombat } from '../../src/sim/combat';
import { enqueue, createRadioState } from '../../src/sim/radio';
import { createInitialState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { observeTarget } from '../../src/perception/observe';
import type { Scenario } from '../../src/scenario/load';

const valley = loadScenarioFile('valley-road');
const column = valley.doctrines['column'];
if (column === undefined) throw new Error('No column doctrine');
const rates = valley.file.combat.behaviorFireRate;
const open: DrillMap = { routeMeters: (from, to) => distance(from, to), sees: () => true, cover: () => 0 };
const position = { center: { x: 0, y: 0 }, sigmaMeters: 40, headingRad: null, speedMps: null, observedAt: 0 };

const self = (overrides: Partial<UnitSelf> = {}): UnitSelf => ({
  id: 'P' as UnitId, side: 'friendly', position: { x: 0, y: 0 }, slot: { x: 0, y: 0 }, platoonPersonnel: 24, wounded: 0, platoonWounded: 0, platoonFree: 24, platoonInitialPersonnel: 24, woundedWaitSeconds: null, squads: 2, drill: null, drillPhase: null, ownSquads: [], groundVolley: null, role: null,
  viaDone: false, ambushSprung: false, handled: [], routeAhead: [500, 600].map((x) => ({ x, y: 0 })), secondsLeft: 7200, canCallAir: false, ownPosition: position,
  personnel: 24, initialPersonnel: 24, ammunition: 1000, initialAmmunition: 1000, equipment: [], supportWeapons: 1, airWeapons: [], morale: 0.8,
  suppression: 0, underFire: false, mode: 'steady', behavior: null, behaviorSinceTick: 0, groundCover: 0, returnsUsed: 0, patrolIndex: 0,
  objective: { kind: 'MoveTo', area: { center: { x: 3000, y: 0 }, radius: 100 } }, fallback: { center: { x: -500, y: 0 }, radius: 100 }, doctrine: column,
  ...overrides,
});

const contact = (id: string, x: number, source: string, min: number, max: number, grouped = false): ContactEstimate => ({
  contactId: id as ContactId,
  provenance: { sourceId: source, observedAt: 100 },
  identification: 'hostile',
  position: { center: { x, y: 0 }, sigmaMeters: 30, headingRad: null, speedMps: null, observedAt: 100 },
  strength: { kind: 'range', min, max },
  kind: 'infantry',
  activity: 'stationary',
  confidence: 'medium',
  observedWeapons: [],
  ...(grouped ? { grouped: true } : {}),
});

const attack = { kind: 'attack', startedAt: 90, target: { x: 200, y: 0 }, radius: 80, via: null, avoid: null, warned: true } as const;

describe('strength estimates', () => {
  it('counts what it saw and what it was told as one enemy', () => {
    const knowledge = {
      ...emptyKnowledge(),
      contacts: { 'C-1': contact('C-1', 500, 'P', 6, 14), 'C-2': contact('C-2', 520, 'P', 6, 14) },
      reports: { a: contact('C-7', 510, 'F-C2', 15, 50, true), b: contact('C-8', 505, 'F-C2', 15, 50, true) },
    };
    expect(decidePlatoon(self(), knowledge, 100, open).drill?.kind).toBe('attack');
  });

  it('still adds up separate squads an aircraft reported', () => {
    const reports = Object.fromEntries(
      [1, 2, 3, 4].map((n) => [`r${n}`, contact(`A-${n}`, 500 + n * 10, 'RECON-1', 6, 14)]),
    );
    expect(decidePlatoon(self(), { ...emptyKnowledge(), reports }, 100, open).drill?.kind).toBe('bypass');
  });
});

describe('drill roles', () => {
  it('keeps a small platoon together when it can\'t spare a flank', () => {
    const far = { ...attack, kind: 'farAmbush' } as const;
    expect(assignRoles(far, column, [100, 200])).toEqual(['support', 'support']);
    expect(assignRoles(far, column, [100, 200, 300])).toEqual(['support', 'maneuver', 'maneuver']);
  });

  const act = (overrides: Partial<UnitSelf>, map = open) =>
    decideGround(
      self({ drill: attack, ...overrides }),
      { ...emptyKnowledge(), contacts: { 'C-1': contact('C-1', 200, 'P', 6, 14) } },
      100,
      rates,
      map,
    ).intent;

  it('never orders a fire it has no view for', () => {
    expect(act({ role: 'support' }, { ...open, sees: () => false }).kind).toBe('move');
  });

  it('keeps an empty squad out of the assault', () => {
    expect(act({ role: 'assault', ammunition: 0 })).toEqual({ kind: 'hold', posture: 'prone' });
  });

  it('keeps a pinned squad down', () => {
    const quiet = { ...open, sees: () => false };
    expect(act({ role: 'bypass', suppression: 0.9 }, quiet)).toEqual({ kind: 'hold', posture: 'prone' });
  });
});

describe('ambushes and aircraft', () => {
  it('a hidden ambush holds its fire at aircraft too', () => {
    const area = { center: { x: 0, y: 0 }, radius: 40 };
    const knowledge = { ...emptyKnowledge(), noticedAircraft: { position: { x: 0, y: 0 }, altitudeMeters: 100, seenAt: 100 } };
    const armed = {
      airWeapons: [{ weapon: 'HEAVY_MACHINE_GUN', count: 1, definition: valley.file.combat.weapons.HEAVY_MACHINE_GUN }],
      objective: { kind: 'AmbushArea', area, openFireMeters: 100 },
      doctrine: { ...column, airFireThreshold: 0.01 },
    } as Partial<UnitSelf>;
    expect(decideGround(self(armed), knowledge, 100, rates, open).firesAtAircraft).toBe(false);
    expect(decideGround(self({ ...armed, ambushSprung: true }), knowledge, 100, rates, open).firesAtAircraft).toBe(true);
  });
});

describe('orders', () => {
  const withOrders = (schedule: unknown[], active = 0): Scenario => {
    const units = valley.file.units.map((unit) =>
      unit.id === 'F-C1' ? { ...unit, objectiveSchedule: schedule, activeFromSeconds: active } : unit,
    );
    return { ...valley, file: { ...valley.file, units } } as Scenario;
  };
  const area = (x: number) => ({ center: { x, y: 3700 }, radius: 300 });

  it('runs chained objectives one at a time', () => {
    const scenario = withOrders([
      { afterObjective: true, objective: { kind: 'MoveTo', area: area(1000) } },
      { afterObjective: true, objective: { kind: 'MoveTo', area: area(500) } },
    ]);
    const state = createInitialState(scenario, 1);
    const platoon = state.truth.platoons['F-C1'];
    if (platoon === undefined) throw new Error('No platoon');
    platoon.objective = { kind: 'MoveTo', area: { center: { x: 2110, y: 3700 }, radius: 500 } };
    while (state.tick < 11) step(state, [], scenario);
    expect(platoon.ordersUsed).toEqual([0]);
  });

  it('keeps a timed order for a platoon that isn\'t active yet', () => {
    const late = { kind: 'HoldArea', area: area(1500) };
    const scenario = withOrders([{ fromSeconds: 10, objective: late }], 100);
    const state = createInitialState(scenario, 1);
    while (state.tick < 11) step(state, [], scenario);
    expect(state.truth.platoons['F-C1']?.objective).toEqual(late);
  });
});

describe('radio', () => {
  it('queues a different drill behind one still waiting to go out', () => {
    const { truth } = createInitialState(valley, 1);
    const radio = createRadioState(Object.values(truth.platoons));
    const unit = radio.units['F-C1'];
    if (unit === undefined) throw new Error('No radio');
    const need = (drill: 'attack' | 'nearAmbush'): ReportNeed => ({ kind: 'DRILL', contactId: null, drill });
    enqueue(unit, need('attack'), 0);
    enqueue(unit, need('nearAmbush'), 1);
    enqueue(unit, need('nearAmbush'), 2);
    expect(unit.queue).toHaveLength(2);
  });

  it('moves the unit\'s marker with a drill report', () => {
    const player = emptyPlayerKnowledge();
    const moved = { ...position, center: { x: 900, y: 900 } };
    const message: RadioMessage = {
      id: 'M-1' as RadioMessage['id'], senderId: 'F-C1', observedAt: 0, sentAt: 0, receivedAt: 0, kind: 'DRILL', ownPosition: moved, drill: 'bypass',
    };
    receiveByPlayer(player, message, 120);
    expect(player.friendlies['F-C1']?.position.center).toEqual(moved.center);
  });

  it('blinks at the most important level heard, not the oldest', () => {
    const player = emptyPlayerKnowledge();
    const meta = { id: 'M-1' as RadioMessage['id'], senderId: 'F-C1', observedAt: 0, sentAt: 0 };
    player.log.push(
      { ...meta, receivedAt: 100, kind: 'POSITION_REPORT', position },
      { ...meta, receivedAt: 110, kind: 'DRILL', ownPosition: position, drill: 'attack' },
    );
    expect(project(player, [], 115, valley.file.display).reporting).toEqual([{ senderId: 'F-C1', level: 'main' }]);
  });
});

describe('perception', () => {
  it('a nearer squad improves on the look a further one took', () => {
    const state = createInitialState(valley, 1);
    const [far, near] = state.truth.platoons['F-C1']?.squads ?? [];
    const target = state.truth.platoons['E-A1']?.squads[0];
    if (far === undefined || near === undefined || target === undefined) throw new Error('Expected squads');
    const observer = (from: typeof far, quality = 100) => ({
      id: 'F-C1', side: 'friendly', position: from.position, medium: 'ground', sees: () => true, rangeTo: () => 500,
      quality, rangeMeters: 500, suppression: 0, detectionBoost: () => 1000,
    }) as const;
    target.position = { x: 2000, y: 3000 };
    target.posture = 'moving';
    far.position = { x: 2000, y: 3460 };
    near.position = { x: 2000, y: 3060 };
    const flat = { ...valley.terrain, elevation: new Float32Array(valley.terrain.elevation.length) };
    const rng = createRng(1);
    const first = observeTarget(state.truth, observer(far), target, flat, rng, valley.file.perception, 5);
    const second = observeTarget(state.truth, observer(near), target, flat, rng, valley.file.perception, 10);
    if (first === null || second === null) throw new Error('Expected sightings');
    expect(second.position.sigmaMeters).toBeLessThan(first.position.sigmaMeters);
  });
});

describe('kill zone reading', () => {
  it('does not take one squad seen by two crews for two squads', () => {
    const facing = (id: string, source: string): ContactEstimate => ({ ...contact(id, 1000, source, 6, 14), facingRad: Math.PI });
    const player = emptyPlayerKnowledge();
    for (const entry of [facing('C-1', 'RECON-1'), { ...facing('C-2', 'CAS-1'), strength: { kind: 'range', min: 15, max: 50 } } as ContactEstimate]) {
      player.contacts[`${entry.provenance.sourceId}/${entry.contactId}`] = { contact: entry, viaAircraft: true, status: 'active', statusAt: 0, clearLookSeconds: 0, estimatedLosses: 0 } as never;
    }
    const view = { ...project(player, [], 110, valley.file.display), friendlies: [{ unitId: 'F-C1' }] } as never;
    const passive: Policy = () => [];
    expect(markingKillZones(passive)(view)).toEqual([]);
  });
});

describe('fire goes at places, not units', () => {
  const setup = (aim: { x: number; y: number }) => {
    const { truth } = createInitialState(valley, 1);
    const [firer] = truth.platoons['F-C1']?.squads ?? [];
    const [target] = truth.platoons['E-A1']?.squads ?? [];
    if (firer === undefined || target === undefined) throw new Error('Expected squads');
    firer.position = { x: 2000, y: 3000 };
    target.position = { x: 2100, y: 3000 };
    truth.units = [firer, target];
    firer.intent = { kind: 'engage', aim, closeTo: null, fireRate: 1, prepared: false };
    const flat = { ...valley.terrain, elevation: new Float32Array(valley.terrain.elevation.length) };
    return { truth, firer, target, flat };
  };

  it('misses a squad that is not where the estimate says, and still spends the rounds', () => {
    const { truth, firer, target, flat } = setup({ x: 2000, y: 3290 });
    const rounds = totalAmmunition(firer.equipment);
    target.position = { x: 2000, y: 2500 };
    resolveCombat(truth, flat, valley.file.combat, createRng(1), 0);
    expect(target.suppression).toBe(0);
    expect(totalAmmunition(firer.equipment)).toBeLessThan(rounds);
  });

  it('hits whoever is at the place, whichever squad it thought it saw', () => {
    const { truth, target, flat } = setup({ x: 2100, y: 3000 });
    resolveCombat(truth, flat, valley.file.combat, createRng(1), 0);
    expect(target.suppression).toBeGreaterThan(0);
  });

  it('shares fire between squads at the place', () => {
    const one = setup({ x: 2100, y: 3000 });
    resolveCombat(one.truth, one.flat, valley.file.combat, createRng(1), 0);
    const two = setup({ x: 2100, y: 3000 });
    const beside = two.truth.platoons['E-A1']?.squads[1];
    if (beside === undefined) throw new Error('Expected a second squad');
    beside.position = { x: 2100, y: 3010 };
    two.truth.units.push(beside);
    resolveCombat(two.truth, two.flat, valley.file.combat, createRng(1), 0);
    expect(two.target.suppression).toBeLessThan(one.target.suppression);
  });

  it('lets a support squad suppress a position with nobody in view', () => {
    const intent = decideGround(self({ drill: attack, role: 'support' }), emptyKnowledge(), 100, rates, open).intent;
    expect(intent).toMatchObject({ kind: 'engage', aim: attack.target, fireRate: rates.harass });
  });

  it('holds an assault squad\'s fire until it sees someone', () => {
    expect(decideGround(self({ drill: attack, role: 'assault' }), emptyKnowledge(), 100, rates, open).intent.kind).toBe('move');
  });
});
