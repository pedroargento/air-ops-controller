import type { AircraftId, AircraftOrder, AircraftTelemetry, CasPhase } from '../domain/public/air';
import { atan2, cos, exp, hypot, PI, sin } from '../domain/public/det-math';
import type { ContactEstimate } from '../domain/public/estimates';
import { distance, type Vec2 } from '../domain/public/geometry';
import { emptyKnowledge, type UnitKnowledge } from '../domain/public/ground';
import type { MessageId, RadioMessage, StrikeAssessment } from '../domain/public/radio';
import { cellAt, elevationAt, hasAirLos, type TerrainGrid } from '../domain/public/terrain';
import type { Aircraft, GroundUnit, WorldTruth } from '../domain/truth/world';
import { recordStrike, updateContact, updateFriendly, type PlayerKnowledge, type SensorCoverage } from '../knowledge/player-knowledge';
import { observeTarget, type Observer } from '../perception/observe';
import { nextBinomial, nextBool, nextFloat, type RngState } from '../rng/streams';
import type { Scenario } from '../scenario/load';
import type { AircraftModelConfig, AirConfig, CombatConfig, DisplayConfig, PerceptionConfig } from '../scenario/schema';
import { applyEffects } from './combat';
import type { RadioState } from './radio';

export function createAircraft(scenario: Scenario): Aircraft[] {
  const { air } = scenario.file;
  return air.aircraft
    .map((entry): Aircraft => {
      const type = air.models[entry.model];
      if (type === undefined) throw new Error(`Unknown aircraft model ${entry.model}`);
      return {
        id: entry.id as AircraftId,
        aircraftType: type.role,
        model: entry.model,
        position: air.airbase,
        altitudeMeters: 0,
        targetAltitudeMeters: type.defaultAltitudeMeters,
        headingRad: PI / 2,
        status: 'ready',
        damaged: false,
        lastFiredOnTick: null,
        order: null,
        timerSeconds: 0,
        fuelSeconds: type.fuelSeconds,
        ammunition: type.ammunition,
        nextPassTick: 0,
        contacts: {},
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

function typeOf(aircraft: Aircraft, air: AirConfig): AircraftModelConfig {
  const model = air.models[aircraft.model];
  if (model === undefined) throw new Error(`Unknown aircraft model ${aircraft.model}`);
  return model;
}

function destinationOf(order: AircraftOrder | null): Vec2 | null {
  if (order === null) return null;
  switch (order.kind) {
    case 'MoveTo':
    case 'Orbit':
      return order.point;
    case 'ReconArea':
    case 'SupportArea':
      return order.center;
    case 'ReturnToBase':
      return null;
  }
}

// Never tighter than the aircraft can actually fly.
function orbitRadius(order: AircraftOrder | null, type: AircraftModelConfig): number {
  const tightest = (type.speedMps / type.turnRateRadPerSecond) * 1.2;
  switch (order?.kind) {
    case 'Orbit':
    case 'ReconArea':
    case 'SupportArea':
      return Math.max(tightest, Math.min(order.radius, type.orbitRadiusMeters));
    default:
      return Math.max(tightest, type.orbitRadiusMeters);
  }
}

/** Returns false when the aircraft can't take the order, e.g. during turnaround. */
export function applyOrder(aircraft: Aircraft, order: AircraftOrder, air: AirConfig): boolean {
  if (aircraft.status === 'turnaround' || aircraft.damaged) return false;
  if (order.kind === 'SupportArea' && aircraft.aircraftType !== 'cas') return false;
  if (order.kind === 'ReturnToBase') {
    if (aircraft.status === 'ready') return false;
    aircraft.status = aircraft.status === 'takeoff' ? 'ready' : 'returning';
    aircraft.order = null;
    return true;
  }
  aircraft.order = order;
  if (aircraft.status === 'ready') {
    aircraft.status = 'takeoff';
    aircraft.timerSeconds = typeOf(aircraft, air).takeoffSeconds;
  } else if (aircraft.status !== 'takeoff') {
    aircraft.status = 'enroute';
  }
  return true;
}

function secondsToBase(aircraft: Aircraft, type: AircraftModelConfig, air: AirConfig): number {
  return distance(aircraft.position, air.airbase) / type.speedMps;
}

function burnFuel(aircraft: Aircraft, type: AircraftModelConfig, air: AirConfig): void {
  aircraft.fuelSeconds = Math.max(0, aircraft.fuelSeconds - 1);
  if (aircraft.fuelSeconds <= secondsToBase(aircraft, type, air) + type.bingoMarginSeconds) {
    aircraft.status = 'returning';
    aircraft.order = null;
  }
}

function bearing(from: Vec2, to: Vec2): number {
  return atan2(to.y - from.y, to.x - from.x);
}

function angleBetween(from: number, to: number): number {
  return atan2(sin(to - from), cos(to - from));
}

/** Turns toward `desired` at the type's turn rate, then flies one second along the new heading. */
function steer(aircraft: Aircraft, desired: number, type: AircraftModelConfig): void {
  const limit = type.turnRateRadPerSecond;
  aircraft.headingRad += Math.max(-limit, Math.min(limit, angleBetween(aircraft.headingRad, desired)));
  aircraft.position = {
    x: aircraft.position.x + cos(aircraft.headingRad) * type.speedMps,
    y: aircraft.position.y + sin(aircraft.headingRad) * type.speedMps,
  };
}

/** Flies tangent to the circle, easing back toward it when off the ring. */
function orbitHeading(aircraft: Aircraft, center: Vec2, radius: number): number {
  const gap = distance(aircraft.position, center);
  const tangent = bearing(center, aircraft.position) + PI / 2;
  const offset = Math.max(-1, Math.min(1, (gap - radius) / radius));
  return tangent + (offset * PI) / 3;
}

/** Aircraft movement, fuel and readiness. Runs every tick. */
export function advanceAircraft(aircraft: Aircraft, air: AirConfig, terrain: TerrainGrid): void {
  flyAircraft(aircraft, air);
  if (!isAirborne(aircraft)) {
    aircraft.altitudeMeters = 0;
    return;
  }
  const rate = typeOf(aircraft, air).climbRateMps;
  const wanted = Math.max(aircraft.targetAltitudeMeters, clearanceFloor(aircraft, air, terrain));
  const gap = wanted - aircraft.altitudeMeters;
  aircraft.altitudeMeters += Math.max(-rate, Math.min(rate, gap));
}

/** Pilots keep clear of the ground and of what's just ahead, whatever the altitude order says. */
function clearanceFloor(aircraft: Aircraft, air: AirConfig, terrain: TerrainGrid): number {
  const reach = typeOf(aircraft, air).speedMps * air.terrainLookaheadSeconds;
  const ahead = {
    x: aircraft.position.x + cos(aircraft.headingRad) * reach,
    y: aircraft.position.y + sin(aircraft.headingRad) * reach,
  };
  return Math.max(elevationAt(terrain, aircraft.position), elevationAt(terrain, ahead)) + typeOf(aircraft, air).terrainClearanceMeters;
}

/** Altitude is its own order, so it survives a change of mission. */
export function setTargetAltitude(aircraft: Aircraft, meters: number, air: AirConfig): void {
  const { minAltitudeMeters, maxAltitudeMeters } = typeOf(aircraft, air);
  aircraft.targetAltitudeMeters = Math.max(minAltitudeMeters, Math.min(maxAltitudeMeters, meters));
}

/** Sensors work best close to the ground, measured from the ground beneath the aircraft. */
function altitudeQuality(aircraft: Aircraft, air: AirConfig, terrain: TerrainGrid): number {
  const height = aircraft.altitudeMeters - elevationAt(terrain, aircraft.position);
  const quality = 1 - (height - air.sensorReferenceHeightMeters) / typeOf(aircraft, air).sensorFalloffMeters;
  return Math.max(air.sensorQualityMin, Math.min(air.sensorQualityMax, quality));
}

function flyAircraft(aircraft: Aircraft, air: AirConfig): void {
  const type = typeOf(aircraft, air);
  switch (aircraft.status) {
    case 'ready':
      return;
    case 'takeoff': {
      aircraft.timerSeconds -= 1;
      const destination = destinationOf(aircraft.order);
      if (aircraft.timerSeconds <= 0) {
        aircraft.status = 'enroute';
        if (destination !== null) aircraft.headingRad = bearing(aircraft.position, destination);
      }
      return;
    }
    case 'enroute': {
      const destination = destinationOf(aircraft.order);
      if (destination === null) {
        aircraft.status = 'returning';
        return;
      }
      steer(aircraft, bearing(aircraft.position, destination), type);
      if (distance(aircraft.position, destination) <= orbitRadius(aircraft.order, type)) {
        aircraft.status = 'onStation';
      }
      burnFuel(aircraft, type, air);
      return;
    }
    case 'onStation': {
      const center = destinationOf(aircraft.order);
      if (center === null) return;
      // A helicopter holds its position; anything else has to keep flying.
      if (!type.rotary) steer(aircraft, orbitHeading(aircraft, center, orbitRadius(aircraft.order, type)), type);
      burnFuel(aircraft, type, air);
      return;
    }
    case 'returning':
      steer(aircraft, bearing(aircraft.position, air.airbase), type);
      aircraft.fuelSeconds = Math.max(0, aircraft.fuelSeconds - 1);
      if (distance(aircraft.position, air.airbase) <= type.speedMps) {
        aircraft.position = air.airbase;
        aircraft.status = 'turnaround';
        aircraft.timerSeconds = aircraft.damaged ? type.repairSeconds : type.turnaroundSeconds;
      }
      return;
    case 'turnaround':
      aircraft.timerSeconds -= 1;
      if (aircraft.timerSeconds <= 0) {
        aircraft.status = 'ready';
        aircraft.damaged = false;
        aircraft.fuelSeconds = type.fuelSeconds;
        aircraft.ammunition = type.ammunition;
      }
      return;
  }
}

export function modelOf(aircraft: Aircraft, air: AirConfig): AircraftModelConfig {
  return typeOf(aircraft, air);
}

export function isAirborne(aircraft: Aircraft): boolean {
  return aircraft.status === 'enroute' || aircraft.status === 'onStation' || aircraft.status === 'returning';
}

/**
 * Cues come from what air operations already holds, so a stale or inaccurate report
 * cues the wrong ground. It speeds detection; it never makes a target visible.
 */
function cuedBoost(aircraft: Aircraft, player: PlayerKnowledge, air: AirConfig, tick: number): (t: GroundUnit) => number {
  if (aircraft.order?.kind !== 'SupportArea') return () => 1;
  const cues: Vec2[] = [];
  for (const key of Object.keys(player.contacts).sort()) {
    const entry = player.contacts[key];
    if (entry === undefined || entry.contact.identification !== 'hostile') continue;
    if (entry.contact.provenance.sourceId === aircraft.id) continue;
    if (tick - entry.contact.position.observedAt > air.cueMaxAgeSeconds) continue;
    cues.push(entry.contact.position.center);
  }
  return (target) =>
    cues.some((cue) => distance(cue, target.position) <= air.cueRadiusMeters) ? air.cueDetectionBoost : 1;
}

function aircraftObserver(
  aircraft: Aircraft,
  air: AirConfig,
  terrain: TerrainGrid,
  boost: (t: GroundUnit) => number,
): Observer {
  const type = typeOf(aircraft, air);
  return {
    id: aircraft.id,
    side: 'friendly',
    position: aircraft.position,
    medium: 'air',
    altitudeMeters: aircraft.altitudeMeters,
    quality: type.observerQuality * altitudeQuality(aircraft, air, terrain),
    rangeMeters: type.sensorRadiusMeters,
    suppression: 0,
    detectionBoost: boost,
  };
}

function nextId(radio: RadioState): MessageId {
  radio.nextMessageNumber += 1;
  return `M-${radio.nextMessageNumber}` as MessageId;
}

/**
 * The map already shows every sighting, so the log only announces a confirmed hostile
 * where air operations was not already tracking one from the air.
 */
function isNewSighting(estimate: ContactEstimate, player: PlayerKnowledge, air: AirConfig, tick: number): boolean {
  if (estimate.identification !== 'hostile') return false;
  for (const key of Object.keys(player.contacts).sort()) {
    const known = player.contacts[key];
    if (known === undefined || !known.viaAircraft || known.contact.identification !== 'hostile') continue;
    if (tick - known.contact.position.observedAt > air.cueMaxAgeSeconds) continue;
    if (distance(known.contact.position.center, estimate.position.center) <= air.sightingDedupeMeters) return false;
  }
  return true;
}

/** Aircraft sightings reach air operations automatically, and only prominent ones reach the log. */
export function updateAircraftPerception(
  truth: WorldTruth,
  player: PlayerKnowledge,
  radio: RadioState,
  terrain: TerrainGrid,
  rng: RngState,
  perception: PerceptionConfig,
  air: AirConfig,
  tick: number,
): void {
  for (const aircraft of truth.aircraft) {
    if (!isAirborne(aircraft)) continue;
    const observer = aircraftObserver(aircraft, air, terrain, cuedBoost(aircraft, player, air, tick));
    for (const target of truth.units) {
      if (target.personnel <= 0) continue;
      const estimate = observeTarget(truth, observer, target, terrain, rng, perception, tick);
      if (estimate === null) continue;
      aircraft.contacts[estimate.contactId] = estimate;
      if (estimate.identification === 'friendly') {
        updateFriendly(player, target.id, estimate.position, 'aircraft', tick, perception.contactMemorySeconds);
        if (estimate.activity === 'engaging') player.friendlyEngagedAt[target.id] = tick;
        continue;
      }
      const announce = isNewSighting(estimate, player, air, tick);
      updateContact(player, estimate, tick, true);
      if (announce) {
        player.log.push({
          id: nextId(radio),
          kind: 'CONTACT_REPORT',
          senderId: aircraft.id,
          observedAt: estimate.position.observedAt,
          sentAt: tick,
          receivedAt: tick,
          contact: estimate,
        });
      }
    }
    for (const [id, contact] of Object.entries(aircraft.contacts)) {
      if (tick - contact.position.observedAt > perception.contactMemorySeconds) delete aircraft.contacts[id];
    }
  }
}

function unitForContact(truth: WorldTruth, aircraft: Aircraft, contact: ContactEstimate): GroundUnit | null {
  const tracks = truth.tracks[aircraft.id] ?? {};
  for (const unitId of Object.keys(tracks).sort()) {
    if (tracks[unitId]?.contactId === contact.contactId) {
      return truth.units.find((unit) => unit.id === unitId) ?? null;
    }
  }
  return null;
}

/** A confirmed hostile the aircraft itself holds, inside its assigned area. */
function chooseCasTarget(aircraft: Aircraft, center: Vec2, radius: number, memory: number, tick: number): ContactEstimate | null {
  let best: ContactEstimate | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const id of Object.keys(aircraft.contacts).sort()) {
    const contact = aircraft.contacts[id];
    if (contact === undefined || contact.identification !== 'hostile') continue;
    if (tick - contact.position.observedAt > memory) continue;
    const gap = distance(contact.position.center, center);
    if (gap <= radius && gap < bestGap) {
      best = contact;
      bestGap = gap;
    }
  }
  return best;
}

/** What the crew thinks it did: noisy, because nobody counts casualties from the air. */
function assessStrike(
  casualties: number,
  target: GroundUnit,
  combat: CombatConfig,
  rng: RngState,
  label: string,
): StrikeAssessment {
  const noise = 1 + (nextFloat(rng, label) * 2 - 1) * combat.assessmentNoise;
  return { estimatedCasualties: Math.round(casualties * noise), destroyed: target.personnel <= 0 };
}

function strikePass(
  aircraft: Aircraft,
  contact: ContactEstimate,
  target: GroundUnit,
  truth: WorldTruth,
  player: PlayerKnowledge,
  radio: RadioState,
  terrain: TerrainGrid,
  air: AirConfig,
  combat: CombatConfig,
  display: DisplayConfig,
  rng: RngState,
  tick: number,
): void {
  aircraft.ammunition -= 1;
  const model = typeOf(aircraft, air);
  aircraft.nextPassTick = tick + model.passIntervalSeconds;
  const height = Math.max(0, aircraft.altitudeMeters - elevationAt(terrain, target.position));
  const miss = hypot(distance(contact.position.center, target.position), height * model.strikeMissPerMeterAltitude);
  const accuracy = exp(-(miss * miss) / (2 * air.blastRadiusMeters * air.blastRadiusMeters));
  const cover = cellAt(terrain, target.position).airCover;
  const label = `air/${aircraft.id}/${target.id}`;
  const casualties = nextBinomial(rng, label, target.personnel, model.casualtyFractionPerPass * (1 - cover) * accuracy);
  applyEffects(
    truth,
    [
      {
        targetId: target.id,
        casualties,
        suppression: model.suppressionPerPass * accuracy,
        morale: model.moralePerPass * accuracy,
      },
    ],
    combat,
    rng,
    tick,
  );
  const effectObserved = nextBool(rng, label, accuracy);
  const assessment = effectObserved ? assessStrike(casualties, target, combat, rng, label) : null;
  if (assessment !== null) recordStrike(player, contact, assessment, display.plausibleSpeedMps, tick);
  player.strikes.push({ aircraftId: aircraft.id, position: contact.position.center, tick, effectObserved });
  const message: RadioMessage = {
    id: nextId(radio),
    kind: 'STRIKE_RESULT',
    senderId: aircraft.id,
    observedAt: tick,
    sentAt: tick,
    receivedAt: tick,
    contact,
    effect: effectObserved ? 'effect-observed' : 'no-effect-observed',
    assessment,
  };
  player.log.push(message);
}

/** Search and identification happen in perception; this runs the Engage stage (§8.1). */
export function resolveCas(
  truth: WorldTruth,
  player: PlayerKnowledge,
  radio: RadioState,
  terrain: TerrainGrid,
  air: AirConfig,
  combat: CombatConfig,
  display: DisplayConfig,
  engageMemorySeconds: number,
  rng: RngState,
  tick: number,
): void {
  for (const aircraft of truth.aircraft) {
    if (aircraft.status !== 'onStation' || aircraft.order?.kind !== 'SupportArea') continue;
    if (aircraft.ammunition <= 0 || tick < aircraft.nextPassTick) continue;
    const { center, radius } = aircraft.order;
    const contact = chooseCasTarget(aircraft, center, radius, engageMemorySeconds, tick);
    if (contact === null) continue;
    const target = unitForContact(truth, aircraft, contact);
    if (target === null || target.personnel <= 0 || target.side === 'friendly') continue;
    if (!hasAirLos(terrain, target.position, aircraft.position, aircraft.altitudeMeters)) continue;
    strikePass(aircraft, contact, target, truth, player, radio, terrain, air, combat, display, rng, tick);
  }
}

/** Ground units notice aircraft and react through their own AI, with no automatic aura. */
export function updateAircraftNotice(
  truth: WorldTruth,
  knowledge: Record<string, UnitKnowledge>,
  air: AirConfig,
  terrain: TerrainGrid,
  rng: RngState,
  tick: number,
): void {
  for (const unit of truth.units) {
    if (unit.personnel <= 0 || unit.side === 'friendly') continue;
    for (const aircraft of truth.aircraft) {
      if (!isAirborne(aircraft)) continue;
      if (distance(unit.position, aircraft.position) > air.groundNoticeRangeMeters) continue;
      if (!hasAirLos(terrain, unit.position, aircraft.position, aircraft.altitudeMeters)) continue;
      if (nextBool(rng, `notice/${unit.id}/${aircraft.id}`, air.groundNoticePerScan)) {
        const belief = (knowledge[unit.id] ??= emptyKnowledge());
        // A formation goes to ground when aircraft appear, then gets on with its attack:
        // an orbiting aircraft must not pin it indefinitely just by being there (§8.2).
        const lastCover = belief.hostileAircraftSeenAt;
        if (lastCover === null || tick - lastCover >= unit.doctrine.airCoverRepeatSeconds) {
          belief.hostileAircraftSeenAt = tick;
        }
        // Height above the unit: a weapon's reach is measured from where it stands.
        const altitudeMeters = Math.max(0, aircraft.altitudeMeters - elevationAt(terrain, unit.position));
        belief.noticedAircraft = { position: aircraft.position, altitudeMeters, seenAt: tick };
      }
    }
  }
}

/** Where air operations knows sensors are looking, from aircraft in the air. */
export function sensorCoverage(truth: WorldTruth, air: AirConfig): readonly SensorCoverage[] {
  return truth.aircraft
    .filter(isAirborne)
    .map((aircraft) => ({ position: aircraft.position, radiusMeters: typeOf(aircraft, air).sensorRadiusMeters }));
}

/** What the crew would say they are doing, from the contacts the aircraft itself holds. */
function casPhase(aircraft: Aircraft): CasPhase | null {
  if (aircraft.status !== 'onStation' || aircraft.order?.kind !== 'SupportArea') return null;
  if (aircraft.ammunition <= 0) return 'out-of-ordnance';
  const { center, radius } = aircraft.order;
  const inArea = Object.values(aircraft.contacts).filter((c) => distance(c.position.center, center) <= radius);
  if (inArea.some((contact) => contact.identification === 'hostile')) return 'target-acquired';
  return inArea.some((contact) => contact.identification === 'unidentified') ? 'identifying' : 'searching';
}

export function aircraftTelemetry(truth: WorldTruth, air: AirConfig): AircraftTelemetry {
  return truth.aircraft.map((aircraft) => {
    const type = typeOf(aircraft, air);
    const destination = destinationOf(aircraft.order);
    const flying = aircraft.status === 'enroute' || aircraft.status === 'takeoff';
    const takeoff = aircraft.status === 'takeoff' ? aircraft.timerSeconds : 0;
    return {
      aircraftId: aircraft.id,
      aircraftType: aircraft.aircraftType,
      model: typeOf(aircraft, air).displayName,
      rotary: typeOf(aircraft, air).rotary,
      position: aircraft.position,
      altitudeMeters: aircraft.altitudeMeters,
      targetAltitudeMeters: aircraft.targetAltitudeMeters,
      headingRad: aircraft.headingRad,
      status: aircraft.status,
      damaged: aircraft.damaged,
      casPhase: casPhase(aircraft),
      order: aircraft.order,
      fuelFraction: aircraft.fuelSeconds / type.fuelSeconds,
      ammunition: aircraft.ammunition,
      etaSeconds:
        flying && destination !== null ? takeoff + distance(aircraft.position, destination) / type.speedMps : null,
      availableInSeconds:
        aircraft.status === 'turnaround'
          ? aircraft.timerSeconds
          : aircraft.status === 'returning'
            ? secondsToBase(aircraft, type, air) + (aircraft.damaged ? type.repairSeconds : type.turnaroundSeconds)
            : 0,
    };
  });
}
