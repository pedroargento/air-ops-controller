import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/cli/battle';
import { noAir, reconInformed } from '../../src/policies/air-policies';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import type { ContactId, UnitId } from '../../src/domain/public/ground';
import type { GroundUnit, Track, WorldTruth } from '../../src/domain/truth/world';
import { createRng } from '../../src/rng/streams';
import { effectiveCover, resolveCombat } from '../../src/sim/combat';
import { updateOutcome } from '../../src/sim/outcome';
import { createInitialState } from '../../src/sim/state';

const scenario = loadScenarioFile();
const { combat, capture } = scenario.file;

// Two opposing units on open ground, 100 m apart, engaged with each other.
function duel(reverseOrder = false): { truth: WorldTruth; a: GroundUnit; b: GroundUnit } {
  const { truth } = createInitialState(scenario, 1);
  const a = truth.units.find((u) => u.id === ('F-A' as UnitId)) as GroundUnit;
  const b = truth.units.find((u) => u.id === ('E-N1' as UnitId)) as GroundUnit;
  a.position = { x: 100, y: 100 };
  b.position = { x: 200, y: 100 };
  a.personnel = a.initialPersonnel = 30;
  b.personnel = b.initialPersonnel = 30;
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
    [a.id]: { [b.id]: track('C-1', b) },
    [b.id]: { [a.id]: track('C-2', a) },
  };
  a.intent = { kind: 'engage', contactId: 'C-1' as never, closeTo: null };
  b.intent = { kind: 'engage', contactId: 'C-2' as never, closeTo: null };
  a.posture = b.posture = 'firing';
  return { truth, a, b };
}

describe('combat', () => {
  it('uses the same rules for both sides', () => {
    const { truth, a, b } = duel();
    a.doctrine = b.doctrine;
    a.morale = b.morale;
    a.ammunition = b.ammunition;
    let casualtiesA = 0;
    let casualtiesB = 0;
    for (let i = 0; i < 400; i += 1) {
      a.personnel = b.personnel = 30;
      a.suppression = b.suppression = 0;
      a.ammunition = b.ammunition = 8000;
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
    a.ammunition = 0;
    const before = b.suppression;
    resolveCombat(truth, {}, scenario.terrain, combat, createRng(1), 10);
    expect(b.suppression).toBe(before);
    expect(b.ammunition).toBeLessThan(b.initialAmmunition);
  });

  it('gives better cover to a defending unit than to a moving one', () => {
    const { a } = duel();
    a.posture = 'moving';
    const moving = effectiveCover(a, scenario.terrain, combat);
    a.posture = 'defending';
    expect(effectiveCover(a, scenario.terrain, combat)).toBeGreaterThan(moving);
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
    expect(truth.outcome).toBe('captured');
  });

  it('resets capture progress when the condition lapses', () => {
    const truth = atOutpost();
    for (let tick = 1; tick <= 30; tick += 1) updateOutcome(truth, capture, 4500, tick);
    const enemies = truth.units.filter((u) => u.side === 'enemy');
    for (const unit of enemies) unit.mode = 'broken';
    updateOutcome(truth, capture, 4500, 31);
    expect(truth.captureProgressSeconds).toBe(0);
  });

  it('requires minimum defenders for success at the deadline', () => {
    const strong = createInitialState(scenario, 1).truth;
    for (const u of strong.units) if (u.side === 'friendly') u.position = capture.area.center;
    updateOutcome(strong, capture, 4500, 4500);
    expect(strong.outcome).toBe('held');

    const weak = createInitialState(scenario, 1).truth;
    for (const u of weak.units) if (u.side === 'friendly') u.personnel = 5;
    updateOutcome(weak, capture, 4500, 4500);
    expect(weak.outcome).toBe('heldBelowStrength');
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
      seeds.filter((seed) => runBattle(scenario, seed, make()).outcome === 'held').length;
    expect(wins(() => noAir)).toBe(0);
    expect(wins(() => reconInformed(objective, true))).toBeGreaterThanOrEqual(15);
  }, 60000);
});
