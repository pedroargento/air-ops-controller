import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/cli/battle';
import { noAir, reconInformed } from '../../src/policies/air-policies';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import { totalAmmunition } from '../../src/domain/public/equipment';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import type { ContactId, UnitId } from '../../src/domain/public/ground';
import type { GroundUnit, Track, WorldTruth } from '../../src/domain/truth/world';
import { createRng } from '../../src/rng/streams';
import { applyEffects, effectiveCover, resolveCombat } from '../../src/sim/combat';
import { effectiveStrength, updateOutcome } from '../../src/sim/outcome';
import { platoonOf } from '../../src/sim/platoon';
import { createInitialState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { singleSquads, squadOf } from '../support/single-squads';

const scenario = singleSquads(loadScenarioFile());
const { combat, mission: capture } = scenario.file;
if (capture.kind !== 'HoldArea') throw new Error('The outpost is a hold mission');

function arm(unit: GroundUnit, rounds: number, machineGuns = 0): void {
  unit.equipment = [{ weapon: 'SMALL_ARMS', quantity: unit.personnel, ammunition: rounds }];
  if (machineGuns > 0) unit.equipment.push({ weapon: 'MACHINE_GUN', quantity: machineGuns, ammunition: rounds });
  unit.initialAmmunition = totalAmmunition(unit.equipment);
}

// Two opposing units on open ground, 100 m apart, engaged with each other.
function duel(reverseOrder = false): { truth: WorldTruth; a: GroundUnit; b: GroundUnit } {
  const { truth } = createInitialState(scenario, 1);
  const a = squadOf(truth, 'F-A');
  const b = squadOf(truth, 'E-N1');
  a.position = { x: 100, y: 100 };
  b.position = { x: 200, y: 100 };
  a.personnel = a.initialPersonnel = 30;
  b.personnel = b.initialPersonnel = 30;
  platoonOf(truth, a).initialPersonnel = 30;
  platoonOf(truth, b).initialPersonnel = 30;
  arm(a, 8000);
  arm(b, 8000);
  truth.units = reverseOrder ? [b, a] : [a, b];
  const track = (contactId: string, seen: GroundUnit): Track => ({
    contactId: contactId as ContactId,
    anchor: seen.position,
    errorOffset: { x: 0, y: 0 },
    lastActivity: 'stationary',
    lastSeenPosition: seen.position,
    lastSeenTick: 0,
    estimate: {} as ContactEstimate,
  });
  truth.tracks = {
    [a.platoonId]: { [b.id]: track('C-1', b) },
    [b.platoonId]: { [a.id]: track('C-2', a) },
  };
  a.intent = { kind: 'engage', contactId: 'C-1' as never, closeTo: null, fireRate: 1, prepared: false };
  b.intent = { kind: 'engage', contactId: 'C-2' as never, closeTo: null, fireRate: 1, prepared: false };
  a.posture = b.posture = 'firing';
  return { truth, a, b };
}

describe('combat', () => {
  it('uses the same rules for both sides', () => {
    const { truth, a, b } = duel();
    a.doctrine = b.doctrine;
    platoonOf(truth, a).doctrine = platoonOf(truth, b).doctrine;
    platoonOf(truth, a).morale = platoonOf(truth, b).morale;
    let casualtiesA = 0;
    let casualtiesB = 0;
    for (let i = 0; i < 400; i += 1) {
      a.personnel = b.personnel = 30;
      a.suppression = b.suppression = 0;
      arm(a, 8000);
      arm(b, 8000);
      resolveCombat(truth, {}, scenario.terrain, combat, createRng(i), i);
      casualtiesA += 30 - a.personnel;
      casualtiesB += 30 - b.personnel;
    }
    expect(casualtiesA).toBeGreaterThan(0);
    expect(Math.abs(casualtiesA - casualtiesB) / (casualtiesA + casualtiesB)).toBeLessThan(0.15);
  });

  it('does not depend on unit order', () => {
    const forward = duel(false);
    const backward = duel(true);
    resolveCombat(forward.truth, {}, scenario.terrain, combat, createRng(5), 10);
    resolveCombat(backward.truth, {}, scenario.terrain, combat, createRng(5), 10);
    expect(backward.a.personnel).toBe(forward.a.personnel);
    expect(backward.b.personnel).toBe(forward.b.personnel);
    expect(backward.a.suppression).toBe(forward.a.suppression);
    expect(backward.b.suppression).toBe(forward.b.suppression);
  });

  it('computes effects from one snapshot, so a unit killed this update still fires', () => {
    const { truth, a, b } = duel();
    a.personnel = 1;
    resolveCombat(truth, {}, scenario.terrain, combat, createRng(1), 10);
    expect(b.suppression).toBeGreaterThan(0);
  });

  it('spends ammunition and stops firing when none is left', () => {
    const { truth, a, b } = duel();
    arm(a, 0);
    const before = b.suppression;
    resolveCombat(truth, {}, scenario.terrain, combat, createRng(1), 10);
    expect(b.suppression).toBe(before);
    expect(totalAmmunition(b.equipment)).toBeLessThan(b.initialAmmunition);
  });

  it('gives better cover to a defending unit than to a moving one', () => {
    const { a } = duel();
    a.posture = 'moving';
    const moving = effectiveCover(a, scenario.terrain, combat);
    a.posture = 'defending';
    expect(effectiveCover(a, scenario.terrain, combat)).toBeGreaterThan(moving);
  });
});

describe('suppression, morale and attrition', () => {
  const harmless = {
    ...combat,
    weapons: { ...combat.weapons, SMALL_ARMS: { ...combat.weapons.SMALL_ARMS, damageEffect: 0 } },
  };

  // `a` takes harmless fire from `b`, so that only pressure can change its morale.
  function underFire(updates: number, options: { friendNearby?: boolean; secondFirer?: boolean; ammunition?: number } = {}) {
    const { truth, a, b } = duel();
    a.intent = { kind: 'wait' };
    platoonOf(truth, a).morale = 0.8;
    platoonOf(truth, a).doctrine = a.doctrine;
    a.equipment = [{ weapon: 'SMALL_ARMS', quantity: 30, ammunition: options.ammunition ?? 8000 }];
    arm(b, 1e9);
    if (options.friendNearby ?? true) {
      truth.units.push({ ...a, id: 'F-B/1' as UnitId, platoonId: 'F-B' as UnitId, intent: { kind: 'wait' } });
    }
    if (options.secondFirer ?? false) {
      const second = { ...b, id: 'E-N2/1' as UnitId, platoonId: 'E-N2' as UnitId };
      truth.tracks[second.platoonId] = truth.tracks[b.platoonId] ?? {};
      truth.units.push(second);
    }
    for (let i = 0; i < updates; i += 1) {
      resolveCombat(truth, {}, scenario.terrain, harmless, createRng(i), i * 5);
    }
    return platoonOf(truth, a);
  }

  it('fire alone stops at the doctrine floor', () => {
    const a = underFire(2000);
    expect(a.morale).toBe(a.doctrine.pressureMoraleFloor);
  });

  it('does not stack with the number of units firing', () => {
    expect(underFire(5, { secondFirer: true }).morale).toBe(underFire(5).morale);
  });

  it('running low on ammunition goes below the floor', () => {
    const a = underFire(2000, { ammunition: 1 });
    expect(a.morale).toBeLessThan(a.doctrine.pressureMoraleFloor);
  });

  it('isolation goes below the floor', () => {
    const a = underFire(2000, { friendNearby: false });
    expect(a.morale).toBeLessThan(a.doctrine.pressureMoraleFloor);
  });

  it('suppression recovers once fire stops; casualties and ammunition do not', () => {
    const { truth, a, b } = duel();
    a.intent = { kind: 'wait' };
    b.intent = { kind: 'wait' };
    a.suppression = 0.8;
    a.personnel = 20;
    arm(a, 100);
    for (let i = 0; i < 40; i += 1) resolveCombat(truth, {}, scenario.terrain, combat, createRng(i), i * 5);
    expect(a.suppression).toBeLessThan(0.1);
    expect(a.personnel).toBe(20);
    expect(totalAmmunition(a.equipment)).toBe(100);
  });

  it('morale recovers slowly out of contact, in any mode, up to a cap that falls with casualties', () => {
    const { truth, a, b } = duel();
    a.intent = { kind: 'wait' };
    b.intent = { kind: 'wait' };
    const platoon = platoonOf(truth, a);
    platoon.morale = 0.3;
    a.personnel = 15;
    for (let i = 0; i < 2000; i += 1) resolveCombat(truth, {}, scenario.terrain, combat, createRng(i), i * 5);
    expect(platoon.morale).toBeCloseTo(combat.moraleRecoveryCap * 0.75);
  });

  it('a lower fire rate means less suppression and less ammunition', () => {
    const full = duel();
    const light = duel();
    light.a.intent = { ...light.a.intent, fireRate: 0.35 } as GroundUnit['intent'];
    resolveCombat(full.truth, {}, scenario.terrain, combat, createRng(1), 10);
    resolveCombat(light.truth, {}, scenario.terrain, combat, createRng(1), 10);
    expect(light.b.suppression).toBeCloseTo(full.b.suppression * 0.35);
    expect(light.a.initialAmmunition - totalAmmunition(light.a.equipment)).toBeCloseTo(
      (full.a.initialAmmunition - totalAmmunition(full.a.equipment)) * 0.35,
    );
  });
});

describe('equipment', () => {
  const volleyOn = (setup: (firer: GroundUnit) => void) => {
    const { truth, a, b } = duel();
    setup(a);
    resolveCombat(truth, {}, scenario.terrain, combat, createRng(1), 10);
    return { suppression: b.suppression, spent: a.initialAmmunition - totalAmmunition(a.equipment) };
  };

  it('machine guns add suppression and burn ammunition faster', () => {
    const rifles = volleyOn((firer) => arm(firer, 8000));
    const guns = volleyOn((firer) => arm(firer, 8000, 3));
    expect(guns.suppression).toBeGreaterThan(rifles.suppression);
    expect(guns.spent).toBeGreaterThan(rifles.spent);
  });

  it('gives identical capabilities to identical inventories, whatever the side or doctrine', () => {
    const { truth, a, b } = duel();
    b.doctrine = a.doctrine;
    arm(a, 8000, 2);
    arm(b, 8000, 2);
    a.posture = b.posture = 'firing';
    resolveCombat(truth, {}, scenario.terrain, combat, createRng(1), 10);
    expect(a.suppression).toBeCloseTo(b.suppression);
  });

  it('a weapon with no ground role adds nothing to ground fire', () => {
    const { truth, a, b } = duel();
    a.equipment = [{ weapon: 'MANPADS', quantity: 1, ammunition: 3 }];
    resolveCombat(truth, {}, scenario.terrain, combat, createRng(1), 10);
    expect(b.suppression).toBe(0);
    expect(a.equipment[0]?.ammunition).toBe(3);
  });

  it('stops firing beyond the range of its weapons', () => {
    const { truth, a, b } = duel();
    const short = { ...combat.weapons.SMALL_ARMS, rangeMeters: 50 };
    resolveCombat(truth, {}, scenario.terrain, { ...combat, weapons: { ...combat.weapons, SMALL_ARMS: short } }, createRng(1), 10);
    expect(b.suppression).toBe(0);
    expect(a.lastFiredAtTick).toBeNull();
  });

  it('casualties can destroy specialist systems while small arms just follow personnel', () => {
    const { truth, a, b } = duel();
    arm(a, 8000, 4);
    applyEffects(truth, [{ targetId: a.id, casualties: 29, suppression: 0, morale: 0 }], combat, createRng(1), 10);
    const guns = a.equipment.find((item) => item.weapon === 'MACHINE_GUN');
    expect(guns?.quantity).toBeLessThan(4);
    expect(a.equipment.find((item) => item.weapon === 'SMALL_ARMS')?.quantity).toBe(30);
    expect(b.equipment).toHaveLength(1);
  });

  it('spending a unit\'s last weapon ammunition counts as out of ammunition for any inventory', () => {
    const { truth, a } = duel();
    a.equipment = [{ weapon: 'MANPADS', quantity: 1, ammunition: 2 }];
    a.initialAmmunition = 2;
    expect(effectiveStrength(truth, a)).toBeGreaterThan(0);
    a.equipment = [{ weapon: 'MANPADS', quantity: 1, ammunition: 0 }];
    expect(effectiveStrength(truth, a)).toBe(0);
  });
});

describe('scenario doctrine', () => {
  it.each(Object.entries(scenario.file.doctrines))('%s can be driven off only by more than fire alone', (_name, doctrine) => {
    expect(doctrine.pressureMoraleFloor).toBeGreaterThan(doctrine.withdrawMorale);
  });

  it.each(Object.entries(scenario.file.doctrines))('%s never returns only to withdraw again', (_name, doctrine) => {
    expect(doctrine.returnMaxCasualties).toBeLessThan(doctrine.withdrawCasualties);
  });

  it.each(Object.entries(scenario.file.doctrines))('%s can recover enough morale to return', (_name, doctrine) => {
    const lost = doctrine.returnMaxCasualties;
    expect(combat.moraleRecoveryCap * (1 - lost / 2)).toBeGreaterThanOrEqual(doctrine.returnMorale);
  });
});

describe('scenario pacing', () => {
  it('changes standing orders only on the authored schedule', () => {
    const state = createInitialState(scenario, 1);
    const unit = squadOf(state.truth, 'E-N2');
    const platoon = platoonOf(state.truth, unit);
    const first = platoon.objective;
    const order = platoon.objectiveSchedule[0];
    if (order?.kind !== 'time') throw new Error('Expected a timed order');
    const when = order.fromTick;
    expect(when % 5).toBe(0);
    while (state.tick < when) step(state, [], scenario);
    expect(platoon.objective).toBe(first);
    step(state, [], scenario);
    expect(platoon.objective).toBe(order.objective);
  });

  it('has no formation parked out of the fight before it activates', () => {
    expect(scenario.file.units.every((unit) => unit.activeFromSeconds === 0)).toBe(true);
  });

  it('gives the enemy reconnaissance, harassment, assault and reserve roles', () => {
    const enemy = scenario.file.units.filter((unit) => unit.side === 'enemy');
    expect(new Set(enemy.map((unit) => unit.doctrine))).toEqual(new Set(['recon', 'harass', 'assault', 'antiair']));
    const commits = enemy.flatMap((unit) =>
      unit.objectiveSchedule.flatMap((entry) => ('fromSeconds' in entry ? [entry.fromSeconds] : [])),
    );
    expect(new Set(commits).size).toBeGreaterThan(1);
  });

  it('reports tempo separately from the outcome', () => {
    const { tempo } = runBattle(scenario, 3, noAir);
    expect(tempo.bouts).toBeGreaterThan(1);
    expect(tempo.fireMinuteShare).toBeGreaterThan(0);
    expect(tempo.fireMinuteShare).toBeLessThanOrEqual(1);
    expect(tempo.behaviorChanges).toBeGreaterThan(0);
    const withdrawals = Object.values(tempo.withdrawals).reduce((sum, n) => sum + n, 0);
    expect(withdrawals).toBeGreaterThan(0);
  });
});

describe('outcome', () => {
  function atOutpost(): WorldTruth {
    const { truth } = createInitialState(scenario, 1);
    for (const unit of truth.units) {
      unit.position = capture.area.center;
      if (unit.side === 'friendly') unit.personnel = 0;
    }
    return truth;
  }

  it('captures only after the condition persists for the full hold time', () => {
    const truth = atOutpost();
    for (let tick = 1; tick < capture.holdSeconds; tick += 1) {
      updateOutcome(truth, capture, 4500, tick);
    }
    expect(truth.outcome).toBe('running');
    updateOutcome(truth, capture, 4500, capture.holdSeconds);
    expect(truth.outcome).toBe('failure');
  });

  it('resets capture progress when the condition lapses', () => {
    const truth = atOutpost();
    for (let tick = 1; tick <= 30; tick += 1) updateOutcome(truth, capture, 4500, tick);
    const enemies = truth.units.filter((u) => u.side === 'enemy');
    for (const unit of enemies) platoonOf(truth, unit).mode = 'broken';
    updateOutcome(truth, capture, 4500, 31);
    expect(truth.captureProgressSeconds).toBe(0);
  });

  it('requires minimum defenders for success at the deadline', () => {
    const strong = createInitialState(scenario, 1).truth;
    for (const u of strong.units) if (u.side === 'friendly') u.position = capture.area.center;
    updateOutcome(strong, capture, 4500, 4500);
    expect(strong.outcome).toBe('success');

    const weak = createInitialState(scenario, 1).truth;
    for (const u of weak.units) if (u.side === 'friendly') u.personnel = 5;
    updateOutcome(weak, capture, 4500, 4500);
    expect(weak.outcome).toBe('partial');
  });
});

describe('battle', () => {
  it('produces fighting on both approaches without scripted events', () => {
    const result = runBattle(scenario, 3, noAir);
    expect(result.firstShotTick).not.toBeNull();
    expect(result.enemyUnitsThatFought).toBeGreaterThanOrEqual(4);
  });

  it('is decided by the sim: quick suite of no air and informed air', () => {
    const seeds = Array.from({ length: 50 }, (_, seed) => seed);
    const objective = capture.area.center;
    const wins = (make: () => Parameters<typeof runBattle>[2]) =>
      seeds.filter((seed) => runBattle(scenario, seed, make()).outcome === 'success').length;
    expect(wins(() => noAir)).toBe(0);
    expect(wins(() => reconInformed(objective, true))).toBeGreaterThanOrEqual(10);
  }, 60000);
});
