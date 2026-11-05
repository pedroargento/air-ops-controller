import { cos, sin } from '../domain/public/det-math';
import type { ContactEstimate } from '../domain/public/estimates';
import { distance, type Vec2 } from '../domain/public/geometry';
import type { UnitKnowledge, UnitSelf } from '../domain/public/ground';

/*
 * React to contact (§4.0.3), from the unit's own picture of its fight (§7.3). Fired on, a unit
 * answers the shooter rather than whatever enemy happens to be nearest. A shooter it can see is
 * one of its contacts. One it can't see is a direction, and the unit fires back that way at a
 * guessed range, which hits whoever is really there, or nobody.
 */

const reacts = (self: UnitSelf, knowledge: UnitKnowledge): boolean => self.doctrine.reactToFire && knowledge.fire.since !== null;

/** The nearest contact the unit believes is firing on it, as it now holds it, or null. */
export function shooterContact(self: UnitSelf, knowledge: UnitKnowledge, within: number): ContactEstimate | null {
  if (!reacts(self, knowledge)) return null;
  let best: ContactEstimate | null = null;
  let bestRange = within;
  for (const key of Object.keys(knowledge.fire.from).sort()) {
    const reported = knowledge.fire.from[key]?.contact;
    if (reported === null || reported === undefined) continue;
    const contact = knowledge.contacts[reported.contactId] ?? reported;
    if (contact.identification === 'friendly') continue;
    const range = distance(self.position, contact.position.center);
    if (range <= bestRange) {
      best = contact;
      bestRange = range;
    }
  }
  return best;
}

/** Where to fire back at a shooter nobody has seen: the freshest direction, at a guessed range. */
export function blindAim(self: UnitSelf, knowledge: UnitKnowledge): Vec2 | null {
  if (!reacts(self, knowledge)) return null;
  let freshest: { origin: Vec2; bearingRad: number; observedAt: number } | null = null;
  for (const key of Object.keys(knowledge.fire.from).sort()) {
    const incoming = knowledge.fire.from[key];
    if (incoming === undefined || incoming.contact !== null) continue;
    if (freshest === null || incoming.observedAt > freshest.observedAt) freshest = incoming;
  }
  if (freshest === null) return null;
  const range = Math.min(self.doctrine.blindFireRangeMeters, self.doctrine.engageRangeMeters);
  return { x: freshest.origin.x + cos(freshest.bearingRad) * range, y: freshest.origin.y + sin(freshest.bearingRad) * range };
}
