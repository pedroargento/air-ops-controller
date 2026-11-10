import { cos, PI, sin } from '../domain/public/det-math';
import type { ContactEstimate } from '../domain/public/estimates';
import { distance, type Vec2 } from '../domain/public/geometry';
import type { Area, GroundIntent, UnitKnowledge, UnitSelf } from '../domain/public/ground';

/*
 * Evading and searching (§8.8). A downed aircrew hides from the enemy it knows of and moves to
 * be picked up; hunters, and a friendly search party, close on their best estimate of where it
 * is and sweep around it. Both act only on what they have seen or been told.
 */

const SWEEP_METERS = 400;
const SWEEP_LEG_SECONDS = 90;
const GOLDEN_ANGLE = 2.399963229728653;

/** Hostiles the platoon has seen, or been told about, recently enough to matter. */
function knownEnemies(self: UnitSelf, knowledge: UnitKnowledge, tick: number): readonly ContactEstimate[] {
  const fresh = (contact: ContactEstimate): boolean =>
    contact.identification === 'hostile' && tick - contact.position.observedAt <= self.doctrine.reportMemorySeconds;
  return [...Object.values(knowledge.contacts), ...Object.values(knowledge.reports)].filter(fresh);
}

export type EvadeDecision = Readonly<{ intent: GroundIntent; avoid: Area | null }>;

/**
 * Hides while an enemy it knows of is close, because moving is what gets a man seen. Otherwise
 * it makes for its pickup point, around the enemy it knows of. A helicopter down for it beats
 * everything: it runs for it.
 */
export function evade(self: UnitSelf, knowledge: UnitKnowledge, tick: number): EvadeDecision {
  const { objective, doctrine } = self;
  if (objective.kind !== 'Evade') return { intent: { kind: 'hold', posture: 'hidden' }, avoid: null };
  if (objective.boardAt !== null) return { intent: { kind: 'move', destination: objective.boardAt }, avoid: null };
  const nearest = [...knownEnemies(self, knowledge, tick)].sort(
    (a, b) => distance(a.position.center, self.position) - distance(b.position.center, self.position),
  )[0];
  const gap = nearest === undefined ? Number.POSITIVE_INFINITY : distance(nearest.position.center, self.position);
  if (gap <= doctrine.alertRadiusMeters) return { intent: { kind: 'hold', posture: 'hidden' }, avoid: null };
  const destination = knowledge.pickup ?? objective.pickup ?? objective.area.center;
  if (distance(self.position, destination) <= doctrine.arrivedMeters) return { intent: { kind: 'hold', posture: 'hidden' }, avoid: null };
  const avoid = nearest === undefined ? null : { center: nearest.position.center, radius: doctrine.flankMeters };
  return { intent: { kind: 'move', destination }, avoid };
}

/**
 * Closes on the freshest estimate of its quarry inside the search area, then sweeps around it;
 * with no estimate, it sweeps the area. Hunters and a friendly search party run the same search,
 * and differ only in what they know and what happens when they reach it.
 */
export function search(self: UnitSelf, knowledge: UnitKnowledge, tick: number): GroundIntent {
  const { objective, doctrine } = self;
  if (objective.kind !== 'SearchArea') return { kind: 'hold', posture: 'defending' };
  const { area } = objective;
  const leads = knownEnemies(self, knowledge, tick)
    .filter((contact) => distance(contact.position.center, area.center) <= area.radius * 2)
    .sort((a, b) => b.position.observedAt - a.position.observedAt);
  const lead = leads[0]?.position.center ?? null;
  const focus: Vec2 = lead ?? area.center;
  if (lead !== null && distance(self.position, lead) > SWEEP_METERS / 2) return { kind: 'move', destination: lead };
  // A sweep that walks out at varying ranges and bearings, so nothing near the lead is missed for long.
  let offset = 0;
  for (const char of self.id) offset = (Math.imul(offset, 31) + char.charCodeAt(0)) >>> 0;
  const leg = Math.floor(tick / SWEEP_LEG_SECONDS) + offset;
  const angle = (leg * GOLDEN_ANGLE) % (2 * PI);
  const spread = lead === null ? Math.min(area.radius, SWEEP_METERS * 2) : SWEEP_METERS;
  const reach = spread * (((leg * 0.618033988749895) % 1) * 0.9 + 0.1);
  const point = { x: focus.x + cos(angle) * reach, y: focus.y + sin(angle) * reach };
  return distance(self.position, point) <= doctrine.arrivedMeters ? { kind: 'hold', posture: 'defending' } : { kind: 'move', destination: point };
}
