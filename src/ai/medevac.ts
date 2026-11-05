import { cos, sin } from '../domain/public/det-math';
import type { ContactEstimate } from '../domain/public/estimates';
import { distance, type Vec2 } from '../domain/public/geometry';
import type { DrillMap, UnitKnowledge, UnitSelf } from '../domain/public/ground';

/*
 * Where a platoon wants its wounded picked up (§8.9), chosen from its own picture: a spot near
 * it that none of the enemy it knows of can see, as far from them as it can find, then as close
 * to itself as it can.
 */

const BEARINGS = 8;

export type LandingZone = Readonly<{ pickup: Vec2; hot: boolean }>;

function hostiles(knowledge: UnitKnowledge): readonly ContactEstimate[] {
  return Object.keys(knowledge.contacts)
    .sort()
    .flatMap((id) => {
      const contact = knowledge.contacts[id];
      return contact !== undefined && contact.identification === 'hostile' ? [contact] : [];
    });
}

function candidates(center: Vec2, searchMeters: number): readonly Vec2[] {
  const points: Vec2[] = [center];
  for (const reach of [searchMeters / 2, searchMeters]) {
    for (let index = 0; index < BEARINGS; index += 1) {
      const angle = (2 * Math.PI * index) / BEARINGS;
      points.push({ x: center.x + cos(angle) * reach, y: center.y + sin(angle) * reach });
    }
  }
  return points;
}

/**
 * The pickup point, in the platoon's own reckoning of where it is, and whether the enemy is near
 * it: the platoon is under fire, or knows of an enemy within `hotMeters` of the point.
 */
export function chooseLandingZone(self: UnitSelf, knowledge: UnitKnowledge, sees: DrillMap['sees'], searchMeters: number, hotMeters: number): LandingZone {
  const enemy = hostiles(knowledge);
  const nearestEnemy = (point: Vec2): number => Math.min(Number.POSITIVE_INFINITY, ...enemy.map((contact) => distance(contact.position.center, point)));
  const scored = candidates(self.position, searchMeters).map((point) => ({
    point,
    hidden: !enemy.some((contact) => sees(contact.position.center, point)),
    clearance: nearestEnemy(point),
    walk: distance(self.position, point),
  }));
  scored.sort((a, b) => Number(b.hidden) - Number(a.hidden) || b.clearance - a.clearance || a.walk - b.walk);
  const best = scored[0]?.point ?? self.position;
  // The platoon gives the point as it reckons its own position, error and all.
  const offset = { x: self.ownPosition.center.x - self.position.x, y: self.ownPosition.center.y - self.position.y };
  const hot = self.underFire || nearestEnemy(best) <= hotMeters;
  return { pickup: { x: best.x + offset.x, y: best.y + offset.y }, hot };
}
