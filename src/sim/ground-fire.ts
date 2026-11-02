import { airHitChance, airWeapons, type AirWeapon, type WeaponType } from '../domain/public/equipment';
import { hypot } from '../domain/public/det-math';
import { distance } from '../domain/public/geometry';
import type { Side } from '../domain/public/ground';
import type { MessageId } from '../domain/public/radio';
import { elevationAt, type TerrainGrid } from '../domain/public/terrain';
import { airSightClear } from '../domain/public/weather';
import type { Aircraft, GroundUnit, WorldTruth } from '../domain/truth/world';
import type { PlayerKnowledge } from '../knowledge/player-knowledge';
import { nextBool, nextGaussian, type RngState } from '../rng/streams';
import type { AirConfig, CombatConfig } from '../scenario/schema';
import { isAirborne, modelOf } from './air';
import type { RadioState } from './radio';

const AIRCRAFT_SIDE: Side = 'friendly';
const FIRE_MEMORY_ENTRIES = 8;

/** A weapon's reach is measured from where it stands, so a team on a hill reaches higher. */
function heightAbove(unit: GroundUnit, aircraft: Aircraft, terrain: TerrainGrid): number {
  return Math.max(0, aircraft.altitudeMeters - elevationAt(terrain, unit.position));
}

function slantTo(unit: GroundUnit, aircraft: Aircraft, terrain: TerrainGrid): number {
  return hypot(distance(unit.position, aircraft.position), heightAbove(unit, aircraft, terrain));
}

function nearestAircraft(unit: GroundUnit, truth: WorldTruth, terrain: TerrainGrid, tick: number): Aircraft | null {
  let best: Aircraft | null = null;
  for (const aircraft of truth.aircraft) {
    if (!isAirborne(aircraft) || aircraft.damaged) continue;
    if (!airSightClear(terrain, truth.weather, unit.position, aircraft.position, aircraft.altitudeMeters, tick)) continue;
    if (best === null || slantTo(unit, aircraft, terrain) < slantTo(unit, best, terrain)) best = aircraft;
  }
  return best;
}

function nextId(radio: RadioState): MessageId {
  radio.nextMessageNumber += 1;
  return `M-${radio.nextMessageNumber}` as MessageId;
}

/** Battle damage is one of only two automatic RTBs (§8). The aircraft is never destroyed. */
function damageAircraft(aircraft: Aircraft): void {
  aircraft.damaged = true;
  aircraft.status = 'returning';
  aircraft.order = null;
  aircraft.attackRun = null;
}

/** The crew's own impression: an estimated source, and the weapon only if they saw it. */
function reportFire(
  aircraft: Aircraft,
  unit: GroundUnit,
  weapon: WeaponType,
  hit: boolean,
  damaged: boolean,
  player: PlayerKnowledge,
  radio: RadioState,
  air: AirConfig,
  rng: RngState,
  tick: number,
): void {
  const due =
    hit || aircraft.lastFiredOnTick === null || tick - aircraft.lastFiredOnTick >= air.groundFireReportSeconds;
  if (!due) return;
  aircraft.lastFiredOnTick = tick;
  const label = `groundfire/${aircraft.id}/${unit.id}`;
  const center = {
    x: unit.position.x + nextGaussian(rng, label) * air.groundFireSigmaMeters,
    y: unit.position.y + nextGaussian(rng, label) * air.groundFireSigmaMeters,
  };
  const seen = nextBool(rng, label, air.groundFireWeaponSeenChance) ? weapon : null;
  aircraft.firedOn = [...aircraft.firedOn.slice(-FIRE_MEMORY_ENTRIES + 1), { center, tick, weapon: seen, hit }];
  player.groundFire.push({ aircraftId: aircraft.id, position: center, tick, hit, weapon: seen });
  player.log.push({
    id: nextId(radio),
    kind: 'GROUND_FIRE',
    senderId: aircraft.id,
    observedAt: tick,
    sentAt: tick,
    receivedAt: tick,
    source: { center, sigmaMeters: air.groundFireSigmaMeters, headingRad: null, speedMps: null, observedAt: tick },
    weapon: seen,
    hit,
    damaged,
  });
}

function fireWeapon(unit: GroundUnit, fire: AirWeapon): void {
  const used = fire.count * fire.definition.ammunitionPerUse;
  unit.equipment = unit.equipment.map((item) =>
    item.weapon === fire.weapon ? { ...item, ammunition: Math.max(0, item.ammunition - used) } : item,
  );
}

function bestWeapon(unit: GroundUnit, aircraft: Aircraft, config: CombatConfig, terrain: TerrainGrid): AirWeapon | null {
  const slant = slantTo(unit, aircraft, terrain);
  let best: AirWeapon | null = null;
  let bestChance = 0;
  for (const weapon of airWeapons(unit.equipment, unit.personnel, config.weapons)) {
    const chance = airHitChance(weapon, slant, heightAbove(unit, aircraft, terrain));
    if (chance > bestChance) {
      best = weapon;
      bestChance = chance;
    }
  }
  return best;
}

/** Ground fire uses the same rules for any side: only the aircraft's side decides who shoots. */
export function resolveGroundFire(
  truth: WorldTruth,
  player: PlayerKnowledge,
  radio: RadioState,
  config: CombatConfig,
  air: AirConfig,
  terrain: TerrainGrid,
  rng: RngState,
  tick: number,
): void {
  for (const unit of truth.units) {
    if (!unit.firesAtAircraft || unit.side === AIRCRAFT_SIDE || unit.personnel <= 0) continue;
    if (tick < unit.nextAirFireTick) continue;
    const aircraft = nearestAircraft(unit, truth, terrain, tick);
    if (aircraft === null) continue;
    const fire = bestWeapon(unit, aircraft, config, terrain);
    if (fire === null) continue;
    const model = modelOf(aircraft, air);
    const chance =
      airHitChance(fire, slantTo(unit, aircraft, terrain), heightAbove(unit, aircraft, terrain)) *
      model.hitChanceFactor *
      (1 - unit.suppression * config.suppressionFirePenalty);
    const label = `airfire/${unit.id}/${aircraft.id}`;
    const hit = nextBool(rng, label, Math.min(1, chance));
    // Armor and rugged airframes shrug off some hits; the rest end the mission.
    const damaged = hit && !nextBool(rng, label, model.hitSurvivalChance);
    fireWeapon(unit, fire);
    unit.lastFiredAtTick = tick;
    unit.firedWeapons = [fire.weapon];
    unit.nextAirFireTick = tick + fire.definition.airCycleSeconds;
    reportFire(aircraft, unit, fire.weapon, hit, damaged, player, radio, air, rng, tick);
    if (damaged) damageAircraft(aircraft);
  }
}
