import { distance, type Vec2 } from '../domain/public/geometry';
import { AIR_OPS } from '../domain/public/radio';
import { emptyKnowledge, type UnitKnowledge } from '../domain/public/ground';
import type { GroundUnit, WorldTruth } from '../domain/truth/world';
import { nextGaussian, type RngState } from '../rng/streams';
import type { Scenario } from '../scenario/load';
import { linkedNodes } from './radio';

/*
 * Smoke on the target (§8.1.3): a platoon expecting air marks the enemy it knows of, so the
 * crew finds it sooner. The enemy sees the smoke too, and knows an attack is coming.
 */

/** Air is due over this platoon now: a promised aircraft has arrived, or a suppression is on. */
function airDue(knowledge: UnitKnowledge, tick: number): boolean {
  const promise = knowledge.expectedSupport;
  if (promise !== null && tick >= promise.etaAt && tick <= promise.lapsesAt) return true;
  return Object.values(knowledge.suppressions).some((entry) => tick >= entry.fromTick && tick <= entry.untilTick);
}

/** The nearest hostile the platoon itself holds, within reach of its smoke. */
function markTarget(knowledge: UnitKnowledge, from: Vec2, reach: number, memory: number, tick: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bestRange = reach;
  for (const id of Object.keys(knowledge.contacts).sort()) {
    const contact = knowledge.contacts[id];
    if (contact === undefined || contact.identification !== 'hostile') continue;
    if (tick - contact.position.observedAt > memory) continue;
    const range = distance(from, contact.position.center);
    if (range <= bestRange) {
      best = contact.position.center;
      bestRange = range;
    }
  }
  return best;
}

export function placeMarks(
  truth: WorldTruth,
  knowledge: Record<string, UnitKnowledge>,
  scenario: Scenario,
  rng: RngState,
  tick: number,
): void {
  const { air, radio, perception } = scenario.file;
  truth.marks = truth.marks.filter((mark) => tick - mark.placedAt <= air.markSeconds);
  for (const platoon of Object.values(truth.platoons).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (platoon.side !== 'friendly' || (platoon.lastMarkAt !== undefined && tick - platoon.lastMarkAt < air.markIntervalSeconds)) continue;
    if (!linkedNodes(scenario, platoon.id).includes(AIR_OPS)) continue;
    const belief = knowledge[platoon.id];
    const thrower = platoon.squads.find((squad) => squad.personnel > 0);
    if (belief === undefined || thrower === undefined || !airDue(belief, tick)) continue;
    // Aimed at the platoon's own estimate: a wrong estimate puts the smoke in the wrong place.
    const aim = markTarget(belief, thrower.position, radio.markRangeMeters, perception.contactMemorySeconds, tick);
    if (aim === null) continue;
    const label = `mark/${platoon.id}`;
    const position = { x: aim.x + nextGaussian(rng, label) * air.markErrorMeters, y: aim.y + nextGaussian(rng, label) * air.markErrorMeters };
    truth.marks.push({ position, placedAt: tick, platoonId: platoon.id });
    platoon.lastMarkAt = tick;
    warnTheEnemy(truth, knowledge, position, air.markRadiusMeters, tick);
  }
}

/** Men near the smoke know what it means: an air attack is coming, and they react as trained. */
function warnTheEnemy(truth: WorldTruth, knowledge: Record<string, UnitKnowledge>, point: Vec2, radius: number, tick: number): void {
  const near = (unit: GroundUnit): boolean => unit.side !== 'friendly' && unit.personnel > 0 && distance(unit.position, point) <= radius;
  for (const unit of truth.units.filter(near)) {
    const belief = (knowledge[unit.platoonId] ??= emptyKnowledge());
    const last = belief.hostileAircraftSeenAt;
    if (last === null || tick - last >= unit.doctrine.airCoverRepeatSeconds) belief.hostileAircraftSeenAt = tick;
  }
}

/** Live smoke near a point, as a crew overhead would see it. */
export function smokeNear(truth: WorldTruth, point: Vec2, radius: number): boolean {
  return truth.marks.some((mark) => distance(mark.position, point) <= radius);
}
