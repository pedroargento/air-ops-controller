import { describe, expect, it } from 'vitest';
import { decidePlatoon } from '../../src/ai/decide-ground';
import { assignRoles, DRILLS } from '../../src/ai/drills';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import { distance, type Vec2 } from '../../src/domain/public/geometry';
import {
  emptyKnowledge,
  type ContactId,
  type DrillKind,
  type DrillMap,
  type GroundObjective,
  type UnitKnowledge,
  type UnitSelf,
} from '../../src/domain/public/ground';
import type { Platoon } from '../../src/domain/truth/world';
import { resolveCombat } from '../../src/sim/combat';
import { createRng } from '../../src/rng/streams';
import { createInitialState, type SimState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import type { Scenario } from '../../src/scenario/load';

const outpost = loadScenarioFile();
const valley = loadScenarioFile('valley-road');
const raider = outpost.doctrines['raider'];
const column = outpost.doctrines['column'];
if (raider === undefined || column === undefined) throw new Error('Missing doctrines');

const map: DrillMap = { routeMeters: (from, to) => distance(from, to), sees: () => false, cover: () => 0.3 };

const self = (overrides: Partial<UnitSelf> = {}): UnitSelf => ({
  id: 'P' as UnitSelf['id'],
  side: 'friendly',
  position: { x: 0, y: 0 },
  slot: { x: 0, y: 0 },
  platoonPersonnel: 24, wounded: 0, platoonWounded: 0, platoonFree: 24, platoonInitialPersonnel: 24, woundedWaitSeconds: null,
  squads: 2,
  drill: null, drillPhase: null, ownSquads: [], groundVolley: null,
  role: null,
  viaDone: false,
  ambushSprung: false,
  handled: [],
  routeAhead: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }, { x: 400, y: 0 }, { x: 500, y: 0 }, { x: 600, y: 0 }, { x: 700, y: 0 }],
  secondsLeft: 7200,
  canCallAir: false,
  ownPosition: { center: { x: 0, y: 0 }, sigmaMeters: 40, headingRad: null, speedMps: null, observedAt: 0 },
  personnel: 24,
  initialPersonnel: 24,
  ammunition: 1000,
  initialAmmunition: 1000,
  equipment: [],
  supportWeapons: 1,
  airWeapons: [],
  morale: 0.8,
  suppression: 0,
  underFire: false,
  mode: 'steady',
  behavior: null,
  behaviorSinceTick: 0,
  groundCover: 0,
  returnsUsed: 0,
  patrolIndex: 0,
  objective: { kind: 'MoveTo', area: { center: { x: 3000, y: 0 }, radius: 100 } },
  fallback: { center: { x: -500, y: 0 }, radius: 100 },
  doctrine: column,
  ...overrides,
});

const seen = (x: number, y = 0, id = 'C-1', max = 14, min = 6): ContactEstimate => ({
  contactId: id as ContactId,
  provenance: { sourceId: 'R', observedAt: 100 },
  identification: 'hostile',
  position: { center: { x, y }, sigmaMeters: 30, headingRad: null, speedMps: null, observedAt: 100 },
  strength: { kind: 'range', min, max },
  kind: 'infantry',
  activity: 'stationary',
  confidence: 'medium',
  observedWeapons: [],
});

const sees = (...contacts: readonly ContactEstimate[]): UnitKnowledge => ({
  ...emptyKnowledge(),
  contacts: Object.fromEntries(contacts.map((entry) => [entry.contactId, entry])),
});
const told = (...contacts: readonly ContactEstimate[]): UnitKnowledge => ({
  ...emptyKnowledge(),
  reports: Object.fromEntries(contacts.map((entry) => [entry.contactId, entry])),
});

const started = (unit: UnitSelf, knowledge: UnitKnowledge, tick = 100): DrillKind | null =>
  decidePlatoon(unit, knowledge, tick, map).drill?.kind ?? null;

describe('choosing a drill', () => {
  it('assaults through fire from close by', () => {
    const knowledge = sees(seen(100));
    knowledge.fire.since = 95;
    expect(started(self({ underFire: true }), knowledge)).toBe('nearAmbush');
  });

  it('returns fire and flanks when fired on from further off', () => {
    expect(started(self({ underFire: true }), sees(seen(250)))).toBe('farAmbush');
  });

  it('attacks a weak known position on the route', () => {
    expect(started(self(), told(seen(500)))).toBe('attack');
  });

  it('goes round a strong one', () => {
    expect(started(self(), told(seen(500, 0, 'C-1', 150, 51)))).toBe('bypass');
  });

  it('goes round a weak one when there is no time to attack it', () => {
    expect(started(self({ secondsLeft: 3100 }), told(seen(500)))).toBe('bypass');
  });

  it('makes refusal of an unfavorable attack an experimental behavior', () => {
    const long: DrillMap = { ...map, routeMeters: (from, to, avoid) => distance(from, to) * (avoid === null ? 1 : 3) };
    const knowledge = told(seen(500, 0, 'C-1', 150, 51));
    expect(decidePlatoon(self(), knowledge, 100, long).drill?.kind).toBe('attack');
    expect(decidePlatoon(self({ doctrine: { ...column, experimentalTactics: true } }), knowledge, 100, long).drill).toBeNull();
  });

  it('holds short for air against a strong position it can call air on, once', () => {
    const patient = { ...column, drills: [...column.drills, 'waitForAir', 'pushThrough'] } as const;
    const strong = seen(500, 0, 'C-1', 150, 51);
    expect(started(self({ doctrine: patient, canCallAir: true }), told(strong))).toBe('waitForAir');
    expect(started(self({ doctrine: patient }), told(strong))).toBe('bypass');
    const asked = [{ center: { x: 500, y: 0 }, tick: 50, askedAir: true }];
    expect(started(self({ doctrine: patient, canCallAir: true, handled: asked }), told(strong))).toBe('bypass');
  });

  it('weighs waiting: not for a weak position, without time, after a recent no, or in the enemy\'s sight', () => {
    const patient = { ...column, drills: [...column.drills, 'waitForAir', 'pushThrough'] } as const;
    const strong = seen(500, 0, 'C-1', 150, 51);
    expect(started(self({ doctrine: patient, canCallAir: true }), told(seen(500)))).toBe('attack');
    expect(started(self({ doctrine: patient, canCallAir: true, secondsLeft: 3100 }), told(strong))).not.toBe('waitForAir');
    expect(started(self({ doctrine: patient, canCallAir: true }), { ...told(strong), supportRefusedAt: 50 })).not.toBe('waitForAir');
    const seenFromThere: DrillMap = { ...map, sees: () => true };
    expect(decidePlatoon(self({ doctrine: patient, canCallAir: true }), told(strong), 100, seenFromThere).drill?.kind).not.toBe('waitForAir');
  });

  it('pushes through once air arrives, and gives up waiting when refused', () => {
    const patient = { ...column, drills: [...column.drills, 'waitForAir', 'pushThrough'] } as const;
    const waiting = decidePlatoon(self({ doctrine: patient, canCallAir: true }), told(seen(500, 0, 'C-1', 150, 51)), 100, map).drill;
    const arrived = { ...told(seen(500)), expectedSupport: { aircraftId: 'CAS-1', etaAt: 150, lapsesAt: 400 } };
    expect(decidePlatoon(self({ doctrine: patient, drill: waiting }), arrived, 160, map).drill?.kind).toBe('waitForAir');
    const announced = { ...arrived, suppressions: { 'CAS-1': { aircraftId: 'CAS-1', center: { x: 500, y: 0 }, radius: 100, fromTick: 150, untilTick: 200 } } };
    expect(decidePlatoon(self({ doctrine: patient, drill: waiting }), announced, 160, map).drill?.kind).toBe('pushThrough');
    const lapsed = { ...told(seen(500)), expectedSupport: { aircraftId: 'CAS-1', etaAt: 10, lapsesAt: 50 } };
    expect(decidePlatoon(self({ doctrine: patient, drill: waiting }), lapsed, 160, map).drill?.kind).toBe('waitForAir');
    const refused = { ...told(seen(500)), supportRefusedAt: 120 };
    expect(decidePlatoon(self({ doctrine: patient, drill: waiting }), refused, 160, map).drill).toBeNull();
  });

  it('sets a hasty ambush for an enemy coming towards it', () => {
    const coming = seen(500);
    const moving = { ...coming, activity: 'moving', position: { ...coming.position, headingRad: Math.PI, speedMps: 1 } } as const;
    expect(started(self(), told(moving))).toBe('hastyAmbush');
  });

  it('ignores a position off its route', () => {
    expect(started(self(), told(seen(300, 600)))).toBeNull();
  });

  it('does not stop twice for a position it has dealt with', () => {
    expect(started(self({ handled: [{ center: { x: 500, y: 0 }, tick: 100 }] }), told(seen(500)))).toBeNull();
  });

  it('runs only the drills its doctrine knows', () => {
    const none = { ...column, drills: [] };
    expect(started(self({ doctrine: none, underFire: true }), sees(seen(100)))).toBeNull();
  });

  it('leaves holding units in place and enables patrol drills only experimentally', () => {
    const area = { center: { x: 0, y: 0 }, radius: 100 };
    expect(started(self({ objective: { kind: 'HoldArea', area }, underFire: true }), sees(seen(100)))).toBeNull();
    const patrol: GroundObjective = { kind: 'PatrolArea', waypoints: [{ x: 500, y: 0 }] };
    expect(started(self({ objective: patrol, underFire: true }), sees(seen(100)))).toBeNull();
    expect(started(self({ objective: patrol, underFire: true, doctrine: { ...column, experimentalTactics: true } }), sees(seen(100)))).toBe('farAmbush');
  });
});

describe('ending a drill', () => {
  const active = decidePlatoon(self({ underFire: true }), sees(seen(100)), 100, map).drill;

  it('keeps going while the enemy is in the picture', () => {
    expect(decidePlatoon(self({ drill: active }), sees(seen(100)), 110, map).drill).toBe(active);
  });

  it('ends once the enemy has gone, and remembers the position', () => {
    const result = decidePlatoon(self({ drill: active }), emptyKnowledge(), 200, map);
    expect(result.drill).toBeNull();
    expect(result.handled.at(-1)?.center).toEqual(active?.target);
  });

  it('always ends at the doctrine time limit', () => {
    const end = 100 + column.drillSeconds;
    expect(decidePlatoon(self({ drill: active, underFire: true }), sees({ ...seen(100), position: { ...seen(100).position, observedAt: end } }), end, map).drill).toBeNull();
  });

  it('drops the drill when the platoon breaks', () => {
    expect(decidePlatoon(self({ drill: active, morale: 0.05 }), sees(seen(100)), 110, map).drill).toBeNull();
  });
});

describe('roles', () => {
  it('gives every drill a role for each case', () => {
    for (const definition of Object.values(DRILLS)) {
      expect(definition.lead).toBeTruthy();
      expect(definition.rest).toBeTruthy();
      expect(definition.solo).toBeTruthy();
    }
  });

  it('puts the nearest squads in support and sends the rest to flank', () => {
    const attack = decidePlatoon(self(), told(seen(500)), 100, map).drill;
    if (attack === null) throw new Error('Expected a drill');
    expect(assignRoles(attack, column, [300, 200, 400])).toEqual(['maneuver', 'support', 'maneuver']);
  });

  it('leaves a lone squad nobody to pin for it', () => {
    const attack = decidePlatoon(self({ squads: 1 }), told(seen(500)), 100, map).drill;
    if (attack === null) throw new Error('Expected a drill');
    expect(attack.via).toBeNull();
    expect(assignRoles(attack, column, [300])).toEqual(['assault']);
  });

  it('flanks to the side of the enemy it can\'t be seen from', () => {
    const left = { x: 500, y: column.flankMeters };
    const hidden: DrillMap = { ...map, sees: (_, to) => distance(to, left) > 1 };
    expect(decidePlatoon(self(), told(seen(500)), 100, hidden).drill?.via).toEqual(left);
  });
});

/** A scenario with one attacker and one defender, on any map and either side. */
function fight(base: Scenario, side: 'friendly' | 'enemy', from: Vec2, at: Vec2): Scenario {
  const [template] = base.file.units;
  if (template === undefined) throw new Error('No units');
  const other = side === 'friendly' ? 'enemy' : 'friendly';
  const gear = [
    { weapon: 'SMALL_ARMS', quantity: 36, ammunition: 9000 },
    { weapon: 'MACHINE_GUN', quantity: 3, ammunition: 6000 },
  ] as typeof template.equipment;
  const area = { center: at, radius: 80 };
  const unit = { ...template, equipment: gear, links: undefined, objectiveSchedule: [], activeFromSeconds: 0 };
  const attacker = {
    ...unit,
    id: 'ATTACK',
    name: 'Attack',
    side: side as typeof template.side,
    position: from,
    personnel: 36,
    doctrine: 'raider',
    objective: { kind: 'AssaultArea' as const, area },
    fallback: { center: from, radius: 150 },
    objectiveSchedule: [{ afterObjective: true as const, objective: { kind: 'HoldArea' as const, area } }],
  };
  const defender = {
    ...unit,
    id: 'DEFEND',
    name: 'Defend',
    side: other as typeof template.side,
    position: at,
    personnel: 12,
    equipment: [{ weapon: 'SMALL_ARMS', quantity: 12, ammunition: 1500 }] as typeof template.equipment,
    doctrine: 'patrol',
    morale: 0.6,
    objective: { kind: 'HoldArea' as const, area },
    fallback: { center: at, radius: 90 },
  };
  const mission = { ...base.file.mission, kind: 'HoldArea', area, enemyMinEffective: 1000, defenderMinEffective: 0, holdSeconds: 60, successMinDefenders: 0 } as Scenario['file']['mission'];
  return {
    ...base,
    file: { ...base.file, durationSeconds: 7200, units: [attacker, defender], links: [], ceconMessages: [], mission },
  };
}

function until(state: SimState, scenario: Scenario, done: () => boolean, limit = 7200): void {
  while (state.tick < limit && state.truth.outcome === 'running' && !done()) step(state, [], scenario);
}

const platoon = (state: SimState, id: string): Platoon => {
  const found = state.truth.platoons[id];
  if (found === undefined) throw new Error(`No platoon ${id}`);
  return found;
};

describe('the assault objective', () => {
  it.each([
    ['the outpost, friendly', outpost, 'friendly', { x: 2525, y: 1900 }, { x: 2525, y: 2625 }],
    ['the outpost, enemy', outpost, 'enemy', { x: 2525, y: 1900 }, { x: 2525, y: 2625 }],
    ['the valley, friendly', valley, 'friendly', { x: 1775, y: 2900 }, { x: 1775, y: 2325 }],
    ['the valley, enemy', valley, 'enemy', { x: 1775, y: 2900 }, { x: 1775, y: 2325 }],
  ] as const)('runs unchanged on %s, and ends when the area is clear', (_name, base, side, from, at) => {
    const scenario = fight(base, side, from, at);
    const state = createInitialState(scenario, 1);
    until(state, scenario, () => platoon(state, 'ATTACK').objective.kind !== 'AssaultArea');
    expect(platoon(state, 'ATTACK').objective.kind).toBe('HoldArea');
    const defenders = platoon(state, 'DEFEND');
    expect(defenders.squads.reduce((sum, unit) => sum + unit.personnel, 0) < 12 || defenders.mode !== 'steady').toBe(true);
  });

  it('uses support by fire and flankers', () => {
    const scenario = fight(outpost, 'enemy', { x: 2525, y: 1900 }, { x: 2525, y: 2625 });
    const state = createInitialState(scenario, 1);
    step(state, [], scenario);
    const roles = platoon(state, 'ATTACK').squads.map((unit) => unit.role);
    expect(roles).toContain('support');
    expect(roles).toContain('maneuver');
  });

  it('says so on the radio', () => {
    const scenario = {
      ...fight(outpost, 'friendly', { x: 2525, y: 1900 }, { x: 2525, y: 2625 }),
    };
    const linked = { ...scenario, file: { ...scenario.file, links: [['ATTACK', 'AIR_OPS']] as Scenario['file']['links'] } };
    const state = createInitialState(linked, 1);
    until(state, linked, () => state.player.log.some((message) => message.kind === 'DRILL'), 60);
    expect(state.player.log.find((message) => message.kind === 'DRILL')).toMatchObject({ senderId: 'ATTACK', drill: 'attack' });
  });
});

describe('reaction forces', () => {
  const reserve = (): { scenario: Scenario; state: SimState; qrf: Platoon } => {
    const base = fight(outpost, 'enemy', { x: 800, y: 800 }, { x: 4000, y: 4000 });
    const [attacker, defender] = base.file.units;
    if (attacker === undefined || defender === undefined) throw new Error('Expected units');
    const scenario = {
      ...base,
      file: {
        ...base.file,
        units: [
          {
            ...attacker,
            objective: { kind: 'HoldArea' as const, area: { center: attacker.position, radius: 80 } },
            objectiveSchedule: [{ onContactReport: true as const, radiusMeters: 80 }],
          },
          defender,
        ],
      },
    };
    const state = createInitialState(scenario, 1);
    return { scenario, state, qrf: platoon(state, 'ATTACK') };
  };

  it('holds until a contact is reported', () => {
    const { scenario, state, qrf } = reserve();
    for (let i = 0; i < 100; i += 1) step(state, [], scenario);
    expect(qrf.objective.kind).toBe('HoldArea');
  });

  const reported = (center: Vec2, tick: number): ContactEstimate => {
    const base = seen(0, 0, 'C-9', 50, 15);
    return { ...base, position: { ...base.position, center, observedAt: tick } };
  };

  it('goes to where the report says, on a report alone', () => {
    const { scenario, state, qrf } = reserve();
    const point = { x: 1500, y: 900 };
    state.unitKnowledge['ATTACK'] = told(reported(point, 0));
    step(state, [], scenario);
    expect(qrf.objective).toEqual({ kind: 'AssaultArea', area: { center: point, radius: 80 } });
  });

  it('a wrong report sends it to the wrong place', () => {
    const { scenario, state, qrf } = reserve();
    const wrong = { x: 600, y: 2500 };
    state.unitKnowledge['ATTACK'] = told(reported(wrong, 0));
    step(state, [], scenario);
    for (let i = 0; i < 400; i += 1) step(state, [], scenario);
    const lead = qrf.squads[0];
    const defender = platoon(state, 'DEFEND').squads[0];
    if (lead === undefined || defender === undefined) throw new Error('Expected squads');
    expect(distance(lead.position, wrong)).toBeLessThan(distance({ x: 800, y: 800 }, wrong));
    expect(distance(lead.position, defender.position)).toBeGreaterThan(2000);
  });

  it('fires once', () => {
    const { scenario, state, qrf } = reserve();
    state.unitKnowledge['ATTACK'] = told(reported({ x: 1500, y: 900 }, 0));
    step(state, [], scenario);
    const first = qrf.objective;
    state.unitKnowledge['ATTACK'] = told(reported({ x: 500, y: 500 }, 1));
    for (let i = 0; i < 10; i += 1) step(state, [], scenario);
    expect(qrf.objective).toBe(first);
  });
});

describe('ambushes', () => {
  it('stays hidden, then opens fire with the enemy close', () => {
    const state = createInitialState(valley, 1);
    const ambush = platoon(state, 'E-A1');
    while (state.tick < 300) step(state, [], valley);
    expect(ambush.squads.every((unit) => unit.posture === 'hidden')).toBe(true);
    expect(ambush.ambushSprung).toBe(false);
    until(state, valley, () => ambush.ambushSprung, 2400);
    expect(ambush.ambushSprung).toBe(true);
  });

  it('is deadlier against a platoon nobody warned', () => {
    const volley = (warned: boolean): number => {
      let casualties = 0;
      for (let seed = 1; seed <= 60; seed += 1) {
        const { truth } = createInitialState(valley, seed);
        const ambushers = platoon({ truth } as SimState, 'E-A1');
        const column = platoon({ truth } as SimState, 'F-C1');
        const [firer] = ambushers.squads;
        const [target] = column.squads;
        if (firer === undefined || target === undefined) throw new Error('Expected squads');
        firer.position = { x: 2000, y: 3000 };
        target.position = { x: 2100, y: 3000 };
        truth.units = [firer, target];
        ambushers.ambushSprungAt = 0;
        column.drill = warned
          ? { kind: 'attack', startedAt: 0, target: firer.position, radius: 80, via: null, avoid: null, warned: true }
          : null;
        truth.tracks[firer.platoonId] = {
          [target.id]: {
            contactId: 'C-1' as ContactId,
            anchor: target.position,
            sampleRange: 100,
            errorOffset: { x: 0, y: 0 },
            lastActivity: 'moving',
            lastSeenPosition: target.position,
            lastSeenTick: 0,
            estimate: seen(0),
          },
        };
        firer.intent = { kind: 'engage', aim: target.position, closeTo: null, fireRate: 1, prepared: false };
        const start = target.personnel;
        resolveCombat(truth, valley.terrain, valley.file.combat, createRng(seed), 5);
        casualties += start - target.personnel;
      }
      return casualties;
    };
    expect(volley(false)).toBeGreaterThan(volley(true) * 2);
  });
});

describe('falling back', () => {
  it('rallies close by when it is on the move, instead of going all the way back', () => {
    const shaken = self({ morale: 0.1, underFire: true, doctrine: { ...column, withdrawMorale: 0.2 } });
    const { fallback } = decidePlatoon(shaken, sees({ ...seen(100), position: { ...seen(100).position, observedAt: 100 } }), 100, map);
    expect(distance(fallback.center, { x: 0, y: 0 })).toBe(column.rallyMeters);
  });

  it('keeps the authored fallback when its doctrine has none', () => {
    const shaken = self({ morale: 0.1, doctrine: { ...raider, withdrawMorale: 0.2 } });
    expect(decidePlatoon(shaken, sees(seen(100)), 100, map).fallback).toEqual(shaken.fallback);
  });
});
