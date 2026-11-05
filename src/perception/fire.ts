import { atan2, PI } from '../domain/public/det-math';
import type { IncomingFire } from '../domain/public/fire';
import { distance, type Vec2 } from '../domain/public/geometry';
import { emptyKnowledge, type UnitKnowledge } from '../domain/public/ground';
import type { GroundUnit, WorldTruth } from '../domain/truth/world';
import { nextGaussian, type RngState } from '../rng/streams';
import type { PerceptionConfig } from '../scenario/schema';

/*
 * What a platoon knows of its own fight (§7.3). A squad feels fire landing on it. If the
 * platoon sees the squad firing, the fire comes from that contact; if not, the squad has
 * only a rough direction. A squad also knows what it is shooting at: the contact nearest
 * where it aims. Truth decides who is shooting; the platoon gets only its own estimate.
 */

const FIRING_TICKS = 5;

const bearing = (from: Vec2, to: Vec2): number => atan2(to.y - from.y, to.x - from.x);

function wrap(angle: number): number {
  let a = angle;
  while (a > PI) a -= 2 * PI;
  while (a <= -PI) a += 2 * PI;
  return a;
}

/** Where one squad believes one shooter is: a contact it holds, or only a direction. */
function sourceOf(
  truth: WorldTruth,
  belief: UnitKnowledge,
  squad: GroundUnit,
  firer: GroundUnit,
  at: number,
  rng: RngState,
  config: PerceptionConfig,
  tick: number,
): readonly [string, IncomingFire] {
  const track = truth.tracks[squad.platoonId]?.[firer.id];
  const contact = track === undefined ? undefined : belief.contacts[track.contactId];
  if (contact !== undefined && tick - contact.position.observedAt <= config.fireMemorySeconds) {
    return [contact.contactId, { contact, bearingRad: bearing(squad.position, contact.position.center), spreadRad: 0, origin: squad.position, observedAt: at }];
  }
  const judged = wrap(bearing(squad.position, firer.position) + nextGaussian(rng, `firefrom/${squad.id}/${firer.id}`) * config.fireBearingErrorRad);
  // Directions close together are one: men under fire say "from the north-east", not a bearing.
  const sector = Math.round(judged / config.fireSectorRad);
  const spreadRad = Math.max(config.fireSectorRad, 2 * config.fireBearingErrorRad) / 2;
  return [`bearing/${sector}`, { contact: null, bearingRad: judged, spreadRad, origin: squad.position, observedAt: at }];
}

/** The platoon's contact nearest where a firing squad aims, if close enough to be what it is shooting at. */
function targetOf(belief: UnitKnowledge, aim: Vec2, config: PerceptionConfig): string | null {
  let best: string | null = null;
  let bestGap = config.engageMatchMeters;
  for (const id of Object.keys(belief.contacts).sort()) {
    const contact = belief.contacts[id];
    if (contact === undefined || contact.identification === 'friendly') continue;
    const gap = distance(contact.position.center, aim);
    if (gap <= bestGap) {
      best = id;
      bestGap = gap;
    }
  }
  return best;
}

export function updateFireKnowledge(
  truth: WorldTruth,
  knowledge: Record<string, UnitKnowledge>,
  rng: RngState,
  config: PerceptionConfig,
  tick: number,
): void {
  const memory = config.fireMemorySeconds;
  const units = new Map<string, GroundUnit>(truth.units.map((unit) => [unit.id, unit]));
  for (const platoon of Object.values(truth.platoons)) {
    const belief = (knowledge[platoon.id] ??= emptyKnowledge());
    const fire = belief.fire;
    for (const squad of platoon.squads) {
      for (const firerId of Object.keys(squad.shotBy).sort()) {
        const at = squad.shotBy[firerId] as number;
        if (tick - at > memory || squad.personnel <= 0) {
          delete squad.shotBy[firerId];
          continue;
        }
        const firer = units.get(firerId);
        if (firer === undefined) continue;
        fire.lastAt = Math.max(fire.lastAt ?? at, at);
        const [key, source] = sourceOf(truth, belief, squad, firer, at, rng, config, tick);
        const known = fire.from[key];
        if (known === undefined || known.observedAt <= at) fire.from[key] = source;
      }
      if (squad.personnel <= 0) continue;
      const lost = squad.lastLossAtTick !== null && tick - squad.lastLossAtTick <= memory;
      const pinned = squad.suppression >= squad.doctrine.pinnedSuppression;
      if (fire.lastAt !== null && tick - fire.lastAt <= memory && (lost || pinned)) fire.heavyAt = tick;
      const firing = squad.lastFiredAtTick !== null && tick - squad.lastFiredAtTick <= FIRING_TICKS;
      if (firing && squad.intent.kind === 'engage') {
        const target = targetOf(belief, squad.intent.aim, config);
        if (target !== null) fire.engaging[target] = tick;
      }
    }
    for (const key of Object.keys(fire.from)) {
      if (tick - (fire.from[key] as IncomingFire).observedAt > memory) delete fire.from[key];
    }
    for (const id of Object.keys(fire.engaging)) {
      if (tick - (fire.engaging[id] as number) > memory || belief.contacts[id] === undefined) delete fire.engaging[id];
    }
    const underFire = fire.lastAt !== null && tick - fire.lastAt <= memory;
    if (underFire) fire.since ??= fire.lastAt;
    else fire.since = null;
  }
}
