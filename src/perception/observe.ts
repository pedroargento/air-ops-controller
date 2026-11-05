import { atan2, PI } from '../domain/public/det-math';
import {
  strengthCategory,
  type Confidence,
  type ContactActivity,
  type ContactEstimate,
  type Identification,
  type StrengthEstimate,
} from '../domain/public/estimates';
import type { WeaponType } from '../domain/public/equipment';
import { distance, type Vec2 } from '../domain/public/geometry';
import { emptyKnowledge, type ContactId, type Side, type UnitKnowledge } from '../domain/public/ground';
import { cellAt, hasGroundLos, type TerrainGrid } from '../domain/public/terrain';
import { groundVisibilityMeters, rangeInVisibility, weatherAt } from '../domain/public/weather';
import { lightAt, sightFactor } from '../domain/public/light';
import type { GroundUnit, Track, WorldTruth } from '../domain/truth/world';
import { nextBinomial, nextBool, nextFloat, nextGaussian, type RngState } from '../rng/streams';
import type { PerceptionConfig } from '../scenario/schema';

const SCAN_TICKS = 5;

// Ground units and aircraft observe through the same rules; only these inputs differ.
export type Observer = Readonly<{
  id: string;
  side: Side;
  position: Vec2;
  medium: 'ground' | 'air';
  sees: (target: GroundUnit) => boolean;
  /** How far this observer could see this target in clear air, cut down by the weather. */
  rangeTo: (target: GroundUnit) => number;
  quality: number;
  rangeMeters: number;
  suppression: number;
  detectionBoost: (target: GroundUnit) => number;
  /** Fired recently, so men it sees fall are men it thinks it hit. */
  firing?: boolean;
  /** Where it is firing: only falls near there are taken for its own hits. */
  aim?: Vec2 | null;
  /** A mark near the target helps tell what it is. */
  identifyBoost?: (target: GroundUnit) => number;
}>;

function concealmentAt(observer: Observer, target: GroundUnit, terrain: TerrainGrid): number {
  const cell = cellAt(terrain, target.position);
  return observer.medium === 'air' ? cell.airConcealment : cell.groundConcealment;
}

/** Firing now, so its muzzle flashes give it away in the dark. */
export function isFiring(unit: GroundUnit, tick: number): boolean {
  return unit.lastFiredAtTick !== null && tick - unit.lastFiredAtTick <= SCAN_TICKS;
}

/** The light falling on a place now: the sky through its cloud, or a flare. */
export function lightOn(truth: WorldTruth, point: Vec2, tick: number): number {
  return lightAt(truth.weather.sky, truth.flares, point, tick, weatherAt(truth.weather, point, tick).rain);
}

/** How far sight reaches to a unit, as a share of daylight's, from the light on it. */
export function sightOn(truth: WorldTruth, target: GroundUnit, tick: number): number {
  return sightFactor(truth.weather.sky, lightOn(truth, target.position, tick), isFiring(target, tick));
}

function activityOf(target: GroundUnit, tick: number): ContactActivity {
  if (target.lastFiredAtTick !== null && tick - target.lastFiredAtTick <= SCAN_TICKS) return 'engaging';
  return target.posture === 'moving' ? 'moving' : 'stationary';
}

function hasLineOfSight(observer: Observer, target: GroundUnit, terrain: TerrainGrid): boolean {
  return observer.medium === 'air' ? observer.sees(target) : hasGroundLos(terrain, observer.position, target.position);
}

function detectionChance(
  observer: Observer,
  target: GroundUnit,
  range: number,
  terrain: TerrainGrid,
  config: PerceptionConfig,
  tracked: boolean,
  tick: number,
): number {
  const posture =
    observer.medium === 'air' && target.posture === 'hidden'
      ? config.hiddenAirConcealment
      : config.postureConcealment[target.posture];
  const concealment = 1 - (1 - concealmentAt(observer, target, terrain)) * (1 - posture);
  const activity = activityOf(target, tick);
  const activityBoost =
    activity === 'engaging' ? config.firingBoost : activity === 'moving' ? config.movingBoost : 1;
  const obstruction = observer.medium === 'air' ? 1 - cellAt(terrain, target.position).airObstruction : 1;
  const chance =
    config.baseDetectionPerScan *
    observer.quality *
    (1 - range / observer.rangeMeters) *
    (1 - concealment) *
    obstruction *
    activityBoost *
    (tracked ? config.trackedBoost : 1) *
    observer.detectionBoost(target);
  return Math.min(1, chance);
}

function positionSigma(
  observer: Observer,
  target: GroundUnit,
  range: number,
  terrain: TerrainGrid,
  config: PerceptionConfig,
): number {
  return (
    ((config.sigmaBaseMeters + range * config.sigmaRangeFraction) *
      (1 + concealmentAt(observer, target, terrain) * config.sigmaConcealmentFactor) *
      (1 + observer.suppression * config.sigmaSuppressionFactor)) /
    observer.quality
  );
}

function confidenceFor(sigma: number, config: PerceptionConfig): Confidence {
  if (sigma <= config.highConfidenceSigmaMeters) return 'high';
  return sigma <= config.mediumConfidenceSigmaMeters ? 'medium' : 'low';
}

function estimateStrength(
  target: GroundUnit,
  rng: RngState,
  config: PerceptionConfig,
  label: string,
): StrengthEstimate {
  const seen = nextBinomial(rng, label, target.personnel, config.observableFraction);
  if (seen === 0) return { kind: 'unknown' };
  const noise = 1 + (nextFloat(rng, label) * 2 - 1) * config.strengthNoise;
  return strengthCategory(Math.max(1, (seen / config.observableFraction) * noise));
}

/** Identification may stay missing, but when it resolves it is always correct in v0.1. */
function rollIdentification(
  observer: Observer,
  target: GroundUnit,
  range: number,
  rng: RngState,
  label: string,
  config: PerceptionConfig,
): Identification {
  const chance = config.identifyPerScan * observer.quality * (1 - range / observer.rangeMeters) * (observer.identifyBoost?.(target) ?? 1);
  if (!nextBool(rng, label, Math.min(1, chance))) return 'unidentified';
  if (target.side !== observer.side) return 'hostile';
  // From the air one group of men looks much like another, and more so from far off.
  const mistaken = observer.medium === 'air' && nextBool(rng, label, config.misidentifyChance * (range / observer.rangeMeters) * 2);
  return mistaken ? 'hostile' : 'friendly';
}

function sampleEstimate(
  observer: Observer,
  target: GroundUnit,
  track: Track | null,
  contactId: ContactId,
  range: number,
  terrain: TerrainGrid,
  rng: RngState,
  config: PerceptionConfig,
  tick: number,
): Track {
  const label = `estimate/${observer.id}/${target.id}`;
  const sigma = positionSigma(observer, target, range, terrain, config);
  const errorOffset: Vec2 = {
    x: nextGaussian(rng, label) * sigma,
    y: nextGaussian(rng, label) * sigma,
  };
  const activity = activityOf(target, tick);

  let headingRad: number | null = null;
  let speedMps: number | null = null;
  const previous = track?.lastSeenPosition ?? null;
  const elapsed = track === null ? 0 : tick - track.lastSeenTick;
  if (previous !== null && elapsed > 0 && nextBool(rng, label, config.motionObservedPerScan)) {
    const moved = distance(previous, target.position);
    if (moved > 0) {
      headingRad =
        atan2(target.position.y - previous.y, target.position.x - previous.x) +
        nextGaussian(rng, label) * config.headingNoiseRad;
      speedMps = moved / elapsed;
    }
  }

  const known = track?.estimate.identification ?? 'unidentified';
  const identification =
    known !== 'unidentified' ? known : rollIdentification(observer, target, range, rng, label, config);
  const stayedPut = track !== null && distance(track.anchor, target.position) < config.revisionMoveMeters;
  const keptFacing = stayedPut ? track.estimate.facingRad : undefined;

  const estimate: ContactEstimate = {
    contactId,
    provenance: { sourceId: observer.id, observedAt: tick },
    identification,
    position: {
      center: { x: target.position.x + errorOffset.x, y: target.position.y + errorOffset.y },
      sigmaMeters: sigma,
      headingRad,
      speedMps,
      observedAt: tick,
    },
    strength: estimateStrength(target, rng, config, label),
    kind: identification === 'unidentified' ? 'unknown' : 'infantry',
    activity,
    confidence: confidenceFor(sigma, config),
    observedWeapons: track?.estimate.observedWeapons ?? [],
    // Facing outlives a new look unless the squad has really gone somewhere else.
    ...(keptFacing === undefined ? {} : { facingRad: keptFacing }),
  };

  return {
    contactId,
    anchor: target.position,
    sampleRange: range,
    errorOffset,
    lastActivity: activity,
    lastSeenPosition: target.position,
    lastSeenTick: tick,
    estimate,
  };
}

/**
 * Weapons this scan actually shows: whatever the target just fired, plus, with a good
 * look, what it is carrying. Being identified as hostile reveals nothing by itself.
 */
function seenWeapons(
  observer: Observer,
  target: GroundUnit,
  range: number,
  rng: RngState,
  config: PerceptionConfig,
  tick: number,
): readonly WeaponType[] {
  const fired = activityOf(target, tick) === 'engaging' ? target.firedWeapons : [];
  const chance = config.weaponSeenPerScan * observer.quality * (1 - range / observer.rangeMeters);
  if (!nextBool(rng, `weapons/${observer.id}/${target.id}`, Math.min(1, chance))) return fired;
  return [...fired, ...target.equipment.filter((item) => item.quantity > 0).map((item) => item.weapon)];
}

/** A crew may make out which way a still squad is facing. Once seen, it stays seen. */
function seenFacing(
  observer: Observer,
  target: GroundUnit,
  range: number,
  estimate: ContactEstimate,
  rng: RngState,
  config: PerceptionConfig,
  tick: number,
): number | null {
  if (observer.medium !== 'air' || estimate.facingRad !== undefined) return null;
  if (activityOf(target, tick) !== 'stationary') return null;
  const label = `facing/${observer.id}/${target.id}`;
  const chance = config.facingSeenPerScan * observer.quality * (1 - range / observer.rangeMeters);
  if (!nextBool(rng, label, Math.min(1, chance))) return null;
  return target.facingRad + nextGaussian(rng, label) * config.facingNoiseRad;
}

function isGenuinelyNew(
  track: Track,
  target: GroundUnit,
  range: number,
  config: PerceptionConfig,
  tick: number,
): boolean {
  if (distance(track.anchor, target.position) >= config.revisionMoveMeters) return true;
  if (activityOf(target, tick) !== track.lastActivity) return true;
  // Against the range of the last real look, so a nearer squad improves on a further one.
  return range < track.sampleRange * (1 - config.revisionRangeImprovement);
}

/**
 * A repeat of an unchanged observation keeps the existing estimate, refreshing only
 * its time. Identifying the contact changes its classification, never its position.
 */
function confirmTrack(track: Track, target: GroundUnit, identification: Identification, tick: number): void {
  const { estimate } = track;
  track.lastSeenPosition = target.position;
  track.lastSeenTick = tick;
  track.estimate = {
    ...estimate,
    provenance: { ...estimate.provenance, observedAt: tick },
    position: { ...estimate.position, observedAt: tick },
    identification,
    kind: identification === 'unidentified' ? estimate.kind : 'infantry',
  };
}

/** One observer's scan of one target. Returns the updated estimate if it was detected. */
export function observeTarget(
  truth: WorldTruth,
  unhindered: Observer,
  target: GroundUnit,
  terrain: TerrainGrid,
  rng: RngState,
  config: PerceptionConfig,
  tick: number,
): ContactEstimate | null {
  const range = distance(unhindered.position, target.position);
  if (range > unhindered.rangeMeters) return null;
  const rangeMeters = unhindered.rangeTo(target);
  if (range > rangeMeters) return null;
  // Poor visibility shortens the reach and spoils the look: spotting, position and identity.
  const observer = { ...unhindered, rangeMeters, quality: (unhindered.quality * rangeMeters) / unhindered.rangeMeters };
  const tracks = (truth.tracks[observer.id] ??= {});
  if (!hasLineOfSight(observer, target, terrain)) return null;

  const track = tracks[target.id] ?? null;
  const tracked = track !== null && tick - track.lastSeenTick <= config.contactMemorySeconds;
  const chance = detectionChance(observer, target, range, terrain, config, tracked, tick);
  if (!nextBool(rng, `detect/${observer.id}/${target.id}`, chance)) return null;

  let current: Track;
  if (track === null) {
    truth.nextContactNumber += 1;
    const contactId = `C-${truth.nextContactNumber}` as ContactId;
    current = sampleEstimate(observer, target, null, contactId, range, terrain, rng, config, tick);
  } else if (isGenuinelyNew(track, target, range, config, tick)) {
    current = sampleEstimate(observer, target, track, track.contactId, range, terrain, rng, config, tick);
  } else {
    const known = track.estimate.identification;
    const label = `estimate/${observer.id}/${target.id}`;
    const identification =
      known !== 'unidentified' ? known : rollIdentification(observer, target, range, rng, label, config);
    confirmTrack(track, target, identification, tick);
    current = track;
  }
  const known = new Set(current.estimate.observedWeapons);
  const seen = seenWeapons(observer, target, range, rng, config, tick);
  if (seen.some((weapon) => !known.has(weapon))) {
    const observedWeapons = [...new Set([...known, ...seen])].sort();
    current.estimate = { ...current.estimate, observedWeapons };
  }
  tracks[target.id] = current;
  const facing = seenFacing(observer, target, range, current.estimate, rng, config, tick);
  if (facing !== null) current.estimate = { ...current.estimate, facingRad: facing };
  claimLosses(observer, target, track, current, rng, config);
  return current.estimate;
}

/**
 * A unit that has been firing and sees men in front of it fall believes it hit them. It counts
 * them as best it can and, like any unit in a fight, tends to count high. Fall it didn't cause
 * is claimed too, because it can't tell its own hits from anyone else's.
 */
function claimLosses(observer: Observer, target: GroundUnit, previous: Track | null, current: Track, rng: RngState, config: PerceptionConfig): void {
  const seen = previous?.seenPersonnel ?? target.personnel;
  let claimed = previous?.claimed ?? 0;
  const fallen = seen - target.personnel;
  const aimedAt = observer.aim !== undefined && observer.aim !== null && distance(observer.aim, target.position) <= config.claimAimMeters;
  if (observer.medium === 'ground' && observer.firing === true && aimedAt && fallen > 0) {
    const noise = 1 + nextGaussian(rng, `claim/${observer.id}/${target.id}`) * config.claimNoise;
    claimed += Math.max(0, Math.round(fallen * config.claimOptimism * noise));
  }
  current.seenPersonnel = target.personnel;
  current.claimed = claimed;
  if (claimed > 0) current.estimate = { ...current.estimate, claimedLosses: claimed };
}

/**
 * A position it was firing on has gone quiet: the unit claims the men it last saw there. Its
 * report keeps the old sighting time, because nobody is left to be seen.
 */
function claimTheLast(truth: WorldTruth, observer: Observer, target: GroundUnit, terrain: TerrainGrid, rng: RngState, config: PerceptionConfig): ContactEstimate | null {
  const track = truth.tracks[observer.id]?.[target.id];
  if (track === undefined || (track.seenPersonnel ?? 0) <= 0) return null;
  if (!hasLineOfSight(observer, target, terrain)) return null;
  const before = track.estimate;
  claimLosses(observer, target, track, track, rng, config);
  return track.estimate === before ? null : track.estimate;
}

/** Being told where to look is what a report gives a unit: it finds what it would have missed. */
function reportCue(belief: UnitKnowledge, memory: number, config: PerceptionConfig, tick: number, watchesFire: boolean): (target: GroundUnit) => number {
  const reported = Object.values(belief.reports).filter(
    (report) => report.identification === 'hostile' && tick - report.position.observedAt <= memory,
  );
  const marks = Object.values(belief.pois);
  // Fire from an unseen shooter: men look the way it comes from (§4.0.3).
  const blind = watchesFire ? Object.values(belief.fire.from).filter((incoming) => incoming.contact === null) : [];
  if (reported.length === 0 && marks.length === 0 && blind.length === 0) return () => 1;
  const near = (target: GroundUnit): boolean =>
    reported.some((report) => distance(report.position.center, target.position) <= config.reportCueMeters) ||
    marks.some((poi) => distance(poi.center, target.position) <= poi.radiusMeters + config.reportCueMeters);
  const along = (target: GroundUnit): boolean =>
    blind.some((incoming) => {
      const toward = atan2(target.position.y - incoming.origin.y, target.position.x - incoming.origin.x);
      let gap = Math.abs(toward - incoming.bearingRad);
      if (gap > PI) gap = 2 * PI - gap;
      return gap <= incoming.spreadRad;
    });
  return (target) => (near(target) ? config.reportCueBoost : 1) * (along(target) ? config.fireCueBoost : 1);
}

function groundObserver(
  unit: GroundUnit,
  truth: WorldTruth,
  detectionBoost: (target: GroundUnit) => number,
  tick: number,
  claimWindowSeconds: number,
): Observer {
  // Every squad feeds the platoon's one picture (§4.0.1).
  return {
    id: unit.platoonId,
    side: unit.side,
    position: unit.position,
    medium: 'ground',
    sees: () => true,
    quality: unit.doctrine.observerQuality,
    // Darkness works like poor visibility: a shorter, worse look, unless the target is firing.
    rangeTo: (target) =>
      rangeInVisibility(
        unit.doctrine.detectRangeMeters,
        groundVisibilityMeters(truth.weather, unit.position, target.position, tick),
        truth.weather.clearVisibilityMeters,
      ) * sightOn(truth, target, tick),
    rangeMeters: unit.doctrine.detectRangeMeters,
    suppression: unit.suppression,
    detectionBoost,
    firing: unit.lastFiredAtTick !== null && tick - unit.lastFiredAtTick <= claimWindowSeconds,
    aim: unit.intent.kind === 'engage' ? unit.intent.aim : null,
  };
}

export function updatePerception(
  truth: WorldTruth,
  knowledge: Record<string, UnitKnowledge>,
  terrain: TerrainGrid,
  rng: RngState,
  config: PerceptionConfig,
  tick: number,
): void {
  const cues = new Map<string, (target: GroundUnit) => number>();
  for (const unit of truth.units) {
    const belief = (knowledge[unit.platoonId] ??= emptyKnowledge());
    if (unit.personnel <= 0) continue;
    let observer: Observer | null = null;
    const reach = unit.doctrine.detectRangeMeters;
    for (const target of truth.units) {
      if (target.side === unit.side) continue;
      // Most pairs are far apart, so skip them before any costly work.
      const dx = target.position.x - unit.position.x;
      const dy = target.position.y - unit.position.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      const cue = cues.get(unit.platoonId) ?? reportCue(belief, unit.doctrine.reportMemorySeconds, config, tick, unit.doctrine.reactToFire);
      cues.set(unit.platoonId, cue);
      observer ??= groundObserver(unit, truth, cue, tick, config.claimWindowSeconds);
      if (target.personnel <= 0) {
        const claimed = claimTheLast(truth, observer, target, terrain, rng, config);
        if (claimed !== null) belief.contacts[claimed.contactId] = claimed;
        continue;
      }
      const estimate = observeTarget(truth, observer, target, terrain, rng, config, tick);
      if (estimate !== null) belief.contacts[estimate.contactId] = estimate;
    }
  }
  for (const platoon of Object.values(truth.platoons)) {
    const belief = knowledge[platoon.id];
    if (belief === undefined) continue;
    for (const [id, contact] of Object.entries(belief.contacts)) {
      if (tick - contact.position.observedAt > config.contactMemorySeconds) delete belief.contacts[id];
    }
    for (const [key, report] of Object.entries(belief.reports)) {
      if (tick - report.position.observedAt > platoon.doctrine.reportMemorySeconds) delete belief.reports[key];
    }
  }
}
