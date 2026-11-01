import { atan2 } from '../domain/public/det-math';
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
import { groundVisibilityMeters, rangeInVisibility, type Weather } from '../domain/public/weather';
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
}>;

function concealmentAt(observer: Observer, target: GroundUnit, terrain: TerrainGrid): number {
  const cell = cellAt(terrain, target.position);
  return observer.medium === 'air' ? cell.airConcealment : cell.groundConcealment;
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
  const chance = config.identifyPerScan * observer.quality * (1 - range / observer.rangeMeters);
  if (!nextBool(rng, label, Math.min(1, chance))) return 'unidentified';
  return target.side === observer.side ? 'friendly' : 'hostile';
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
  };

  return {
    contactId,
    anchor: target.position,
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

function isGenuinelyNew(
  track: Track,
  observer: Observer,
  target: GroundUnit,
  range: number,
  config: PerceptionConfig,
  tick: number,
): boolean {
  if (distance(track.anchor, target.position) >= config.revisionMoveMeters) return true;
  if (activityOf(target, tick) !== track.lastActivity) return true;
  const previousRange = distance(observer.position, track.anchor);
  return range < previousRange * (1 - config.revisionRangeImprovement);
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
  } else if (isGenuinelyNew(track, observer, target, range, config, tick)) {
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
  return current.estimate;
}

/** Being told where to look is what a report gives a unit: it finds what it would have missed. */
function reportCue(belief: UnitKnowledge, memory: number, config: PerceptionConfig, tick: number): (target: GroundUnit) => number {
  const reported = Object.values(belief.reports).filter(
    (report) => report.identification === 'hostile' && tick - report.position.observedAt <= memory,
  );
  if (reported.length === 0) return () => 1;
  return (target) =>
    reported.some((report) => distance(report.position.center, target.position) <= config.reportCueMeters)
      ? config.reportCueBoost
      : 1;
}

function groundObserver(
  unit: GroundUnit,
  weather: Weather,
  detectionBoost: (target: GroundUnit) => number,
  tick: number,
): Observer {
  // Every squad feeds the platoon's one picture (§4.0.1).
  return {
    id: unit.platoonId,
    side: unit.side,
    position: unit.position,
    medium: 'ground',
    sees: () => true,
    quality: unit.doctrine.observerQuality,
    rangeTo: (target) =>
      rangeInVisibility(
        unit.doctrine.detectRangeMeters,
        groundVisibilityMeters(weather, unit.position, target.position, tick),
        weather.clearVisibilityMeters,
      ),
    rangeMeters: unit.doctrine.detectRangeMeters,
    suppression: unit.suppression,
    detectionBoost,
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
  for (const unit of truth.units) {
    const belief = (knowledge[unit.platoonId] ??= emptyKnowledge());
    if (unit.personnel <= 0) continue;
    let observer: Observer | null = null;
    const reach = unit.doctrine.detectRangeMeters;
    for (const target of truth.units) {
      if (target.side === unit.side || target.personnel <= 0) continue;
      // Most pairs are far apart, so skip them before any costly work.
      const dx = target.position.x - unit.position.x;
      const dy = target.position.y - unit.position.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      observer ??= groundObserver(unit, truth.weather, reportCue(belief, unit.doctrine.reportMemorySeconds, config, tick), tick);
      const estimate = observeTarget(truth, observer, target, terrain, rng, config, tick);
      if (estimate !== null) belief.contacts[estimate.contactId] = estimate;
    }
    for (const [id, contact] of Object.entries(belief.contacts)) {
      if (tick - contact.position.observedAt > config.contactMemorySeconds) delete belief.contacts[id];
    }
    for (const [key, report] of Object.entries(belief.reports)) {
      if (tick - report.position.observedAt > unit.doctrine.reportMemorySeconds) delete belief.reports[key];
    }
  }
}
