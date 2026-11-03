import { distance, type Vec2 } from '../domain/public/geometry';
import { emptyKnowledge, type UnitKnowledge } from '../domain/public/ground';
import type { Flare } from '../domain/public/light';
import type { Aircraft, WorldTruth } from '../domain/truth/world';
import type { PlayerKnowledge } from '../knowledge/player-knowledge';
import { lightOn } from '../perception/observe';
import { nextGaussian, type RngState } from '../rng/streams';
import type { Scenario } from '../scenario/load';

/*
 * Flares (§8.7): light dropped from aircraft or fired by platoons. Light shows whoever is
 * under it, on either side, so lighting up a fight exposes friends as well as enemies.
 */

/** Share of a flare's burn left below which the next one is dropped, so the light doesn't lapse. */
const RELIGHT_SHARE = 0.25;
const ILLUMINATION_CONTACT_SECONDS = 120;
const ILLUMINATION_ERROR_METERS = 40;

function burning(flare: Flare, tick: number): number {
  return 1 - (tick - flare.ignitedAt) / flare.burnSeconds;
}

/** The controller knows of every flare its own side lit: its aircraft dropped it, or a platoon said so. */
function told(player: PlayerKnowledge, flare: Flare): void {
  player.flares.push(flare);
}

function light(truth: WorldTruth, player: PlayerKnowledge | null, flare: Flare): void {
  truth.flares.push(flare);
  if (player !== null) told(player, flare);
}

/**
 * Aircraft told to illuminate keep a flare burning over the area until the time is up or
 * the flares run out, then watch it. Each drop waits until the last one is nearly out.
 */
export function dropFlares(truth: WorldTruth, player: PlayerKnowledge, scenario: Scenario, tick: number): void {
  const { air } = scenario.file;
  for (const aircraft of truth.aircraft) {
    const order = aircraft.order;
    if (aircraft.status !== 'onStation' || order?.kind !== 'Illuminate') continue;
    if (tick > order.untilTick || aircraft.flares <= 0) {
      aircraft.order = { kind: 'Watch', center: order.center, radius: order.radius };
      continue;
    }
    if (truth.flares.some((flare) => flare.by === aircraft.id && distance(flare.position, order.center) <= order.radius && burning(flare, tick) > RELIGHT_SHARE)) continue;
    aircraft.flares -= 1;
    light(truth, player, { position: order.center, ignitedAt: tick, burnSeconds: air.flareBurnSeconds, radiusMeters: air.flareRadiusMeters, light: air.flareLight, by: aircraft.id });
  }
}

/** The nearest hostile a platoon itself knows of, recently seen, within reach. */
function nearestKnownHostile(knowledge: UnitKnowledge, from: Vec2, reach: number, tick: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bestRange = reach;
  for (const id of Object.keys(knowledge.contacts).sort()) {
    const contact = knowledge.contacts[id];
    if (contact === undefined || contact.identification !== 'hostile' || tick - contact.position.observedAt > ILLUMINATION_CONTACT_SECONDS) continue;
    const range = distance(from, contact.position.center);
    if (range <= bestRange) {
      best = contact.position.center;
      bestRange = range;
    }
  }
  return best;
}

/**
 * Platoons with illumination rounds fire them over the enemy they know of when it's dark
 * and that enemy is unlit: a smaller, shorter light than an aircraft's, and no aircraft needed.
 */
export function fireIllumination(truth: WorldTruth, knowledge: Record<string, UnitKnowledge>, player: PlayerKnowledge, scenario: Scenario, rng: RngState, tick: number): void {
  const { combat } = scenario.file;
  for (const platoon of Object.values(truth.platoons).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const firer = platoon.squads.find((squad) => squad.personnel > 0);
    if (firer === undefined || (platoon.illuminationFired ?? 0) >= firer.doctrine.illuminationRounds) continue;
    if (platoon.lastIlluminationAt !== undefined && tick - platoon.lastIlluminationAt < combat.illuminationIntervalSeconds) continue;
    if (lightOn(truth, firer.position, tick) >= combat.illuminationBelowLight) continue;
    const belief = (knowledge[platoon.id] ??= emptyKnowledge());
    const target = nearestKnownHostile(belief, firer.position, combat.illuminationRangeMeters, tick);
    if (target === null || lightOn(truth, target, tick) >= combat.illuminationBelowLight) continue;
    const label = `illumination/${platoon.id}`;
    const position = { x: target.x + nextGaussian(rng, label) * ILLUMINATION_ERROR_METERS, y: target.y + nextGaussian(rng, label) * ILLUMINATION_ERROR_METERS };
    platoon.illuminationFired = (platoon.illuminationFired ?? 0) + 1;
    platoon.lastIlluminationAt = tick;
    const flare: Flare = { position, ignitedAt: tick, burnSeconds: combat.illuminationBurnSeconds, radiusMeters: combat.illuminationRadiusMeters, light: combat.illuminationLight, by: platoon.id };
    light(truth, platoon.side === 'friendly' ? player : null, flare);
  }
}

/** Burnt-out flares are forgotten, by the sim and by the controller's map. */
export function pruneFlares(truth: WorldTruth, player: PlayerKnowledge, tick: number): void {
  truth.flares = truth.flares.filter((flare) => burning(flare, tick) > 0);
  player.flares = player.flares.filter((flare) => burning(flare, tick) > 0);
}

/** Whether an aircraft can be told to illuminate: it has flares to drop. */
export function canIlluminate(aircraft: Aircraft): boolean {
  return aircraft.flares > 0;
}
