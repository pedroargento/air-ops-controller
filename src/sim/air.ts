import { chooseAttack, chooseStrike, chooseSuppression, decideCrew } from '../ai/decide-crew';
import type {
  AircraftId,
  AircraftOrder,
  AircraftTelemetry,
  AttackRun,
  CasPhase,
  CrewSelf,
  StrikeWeapon,
} from '../domain/public/air';
import { atan2, cos, exp, hypot, PI, sin } from '../domain/public/det-math';
import type { ContactEstimate } from '../domain/public/estimates';
import { distance, type Vec2 } from '../domain/public/geometry';
import { emptyKnowledge, type UnitKnowledge } from '../domain/public/ground';
import type { MessageId, RadioMessage, StrikeAssessment } from '../domain/public/radio';
import { cellAt, elevationAt, type TerrainGrid } from '../domain/public/terrain';
import { airSightClear, airVisibilityMeters, rangeInVisibility, weatherAt, type Weather } from '../domain/public/weather';
import type { Aircraft, GroundUnit, WorldTruth } from '../domain/truth/world';
import { recordStrike, updateContact, updateFriendly, type PlayerKnowledge, type SensorCoverage } from '../knowledge/player-knowledge';
import { observeTarget, type Observer } from '../perception/observe';
import { nextBinomial, nextBool, nextFloat, nextGaussian, type RngState } from '../rng/streams';
import type { Scenario } from '../scenario/load';
import type { AircraftModelConfig, AirConfig, CombatConfig, DisplayConfig, PerceptionConfig } from '../scenario/schema';
import { applyEffects, type CombatEffect } from './combat';
import { enqueue, type RadioState } from './radio';

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
        heldForFriendliesAt: null,
        heldReportAt: null,
        order: null,
        timerSeconds: 0,
        fuelSeconds: type.fuelSeconds,
        ammunition: type.ammunition,
        gunBursts: type.gunBursts,
        nextPassTick: 0,
        risk: 'normal',
        weapons: 'both',
        manualAltitude: false,
        firedOn: [],
        breakSeconds: 0,
        breakPoint: null,
        searchLeg: 0,
        searchPoint: null,
        attackRun: null,
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
  return order === null || order.kind === 'ReturnToBase' ? null : order.center;
}

// Never tighter than the aircraft can actually fly.
function orbitRadius(order: AircraftOrder | null, type: AircraftModelConfig): number {
  const tightest = (type.speedMps / type.turnRateRadPerSecond) * 1.2;
  if (order === null || order.kind === 'ReturnToBase') return Math.max(tightest, type.orbitRadiusMeters);
  return Math.max(tightest, Math.min(order.radius, type.orbitRadiusMeters));
}

/** Firing on the controller's say-so needs something to fire with. */
const FIRE_ORDERS: ReadonlySet<AircraftOrder['kind']> = new Set(['Suppress', 'Strike']);

/** Returns false when the aircraft can't take the order, e.g. during turnaround. */
export function applyOrder(aircraft: Aircraft, order: AircraftOrder, air: AirConfig): boolean {
  if (aircraft.status === 'turnaround' || aircraft.damaged) return false;
  if (FIRE_ORDERS.has(order.kind) && aircraft.aircraftType !== 'cas') return false;
  if (order.kind === 'ReturnToBase') {
    if (aircraft.status === 'ready') return false;
    aircraft.status = aircraft.status === 'takeoff' ? 'ready' : 'returning';
    aircraft.order = null;
    aircraft.attackRun = null;
    return true;
  }
  aircraft.order = order;
  aircraft.attackRun = null;
  aircraft.searchPoint = null;
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
  aircraft.manualAltitude = true;
}

function crewSelf(aircraft: Aircraft, player: PlayerKnowledge, air: AirConfig, combat: CombatConfig, tick: number): CrewSelf {
  const type = typeOf(aircraft, air);
  const weaponCeilings = Object.fromEntries(
    Object.entries(combat.weapons).map(([weapon, definition]) => [weapon, definition.maxAltitudeMeters]),
  ) as CrewSelf['weaponCeilings'];
  return {
    tick,
    role: aircraft.aircraftType,
    rotary: type.rotary,
    status: aircraft.status,
    order: aircraft.order,
    destination: destinationOf(aircraft.order),
    position: aircraft.position,
    risk: aircraft.risk,
    weapons: aircraft.weapons,
    manualAltitude: aircraft.manualAltitude,
    defaultAltitudeMeters: type.defaultAltitudeMeters,
    minAltitudeMeters: type.minAltitudeMeters,
    maxAltitudeMeters: type.maxAltitudeMeters,
    ammunition: aircraft.ammunition,
    gunBursts: aircraft.gunBursts,
    enduranceSeconds: Math.max(0, aircraft.fuelSeconds - secondsToBase(aircraft, type, air) - type.bingoMarginSeconds),
    passIntervalSeconds: type.passIntervalSeconds,
    gunPassFactor: air.gunPassFactor,
    gunsReachable: !aircraft.manualAltitude || aircraft.targetAltitudeMeters <= air.gunRunHeightMeters * air.gunHeightTolerance,
    firedOn: aircraft.firedOn,
    contacts: Object.values(aircraft.contacts),
    forecast: player.forecast,
    weaponCeilings,
    threatMemorySeconds: air.threatMemorySeconds,
    breakReactionSeconds: air.breakReactionSeconds,
    searchLeg: aircraft.searchLeg,
    searchPoint: aircraft.searchPoint,
    attackRun: aircraft.attackRun,
    tuning: air,
  };
}

/** Each crew's decisions about how to fly its mission (§8.0). */
export function updateCrews(truth: WorldTruth, player: PlayerKnowledge, air: AirConfig, combat: CombatConfig, tick: number): void {
  for (const aircraft of truth.aircraft) {
    if (!isAirborne(aircraft) || aircraft.status === 'returning') continue;
    if (aircraft.order?.kind === 'Cover') aircraft.order = followCovered(aircraft.order, player, air);
    const decision = decideCrew(crewSelf(aircraft, player, air, combat, tick));
    if (decision.altitudeMeters !== null) aircraft.targetAltitudeMeters = decision.altitudeMeters;
    aircraft.searchPoint = decision.searchPoint;
    aircraft.searchLeg = decision.searchLeg;
    if (decision.breakFrom !== null && aircraft.breakSeconds <= 0) {
      const gap = Math.max(1, distance(aircraft.position, decision.breakFrom));
      const away = air.breakDistanceMeters / gap;
      aircraft.breakPoint = {
        x: aircraft.position.x + (aircraft.position.x - decision.breakFrom.x) * away,
        y: aircraft.position.y + (aircraft.position.y - decision.breakFrom.y) * away,
      };
      aircraft.breakSeconds = air.breakSeconds;
    }
  }
}

/**
 * Where the covered platoon is going, from the controller's map: its last reported position,
 * pushed ahead along its heading when that's known. A lost platoon leaves the area where it was.
 */
function followCovered(order: Extract<AircraftOrder, { kind: 'Cover' }>, player: PlayerKnowledge, air: AirConfig): AircraftOrder {
  const friendly = player.friendlies[order.unitId];
  if (friendly === undefined) return order;
  const { center, headingRad } = friendly.position;
  const ahead = headingRad === null ? 0 : air.coverAheadMeters;
  const point = { x: center.x + cos(headingRad ?? 0) * ahead, y: center.y + sin(headingRad ?? 0) * ahead };
  return point.x === order.center.x && point.y === order.center.y ? order : { ...order, center: point };
}

/** Sensors work best close to the ground, measured from the ground beneath the aircraft. */
function altitudeQuality(aircraft: Aircraft, air: AirConfig, terrain: TerrainGrid): number {
  const height = aircraft.altitudeMeters - elevationAt(terrain, aircraft.position);
  const quality = 1 - (height - air.sensorReferenceHeightMeters) / typeOf(aircraft, air).sensorFalloffMeters;
  return Math.max(air.sensorQualityMin, Math.min(air.sensorQualityMax, quality));
}

function flyAttackRun(aircraft: Aircraft, run: AttackRun, type: AircraftModelConfig): void {
  if (run.phase === 'runIn') {
    steer(aircraft, bearing(aircraft.position, run.aim), type);
    return;
  }
  steer(aircraft, aircraft.headingRad, type);
  const pullOffSeconds = run.pullOffSeconds - 1;
  aircraft.attackRun = pullOffSeconds <= 0 ? null : { ...run, pullOffSeconds };
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
      const center = aircraft.searchPoint ?? destinationOf(aircraft.order);
      if (center === null) return;
      if (aircraft.breakSeconds > 0 && aircraft.breakPoint !== null) {
        aircraft.breakSeconds -= 1;
        steer(aircraft, bearing(aircraft.position, aircraft.breakPoint), type);
      } else if (aircraft.attackRun !== null) {
        flyAttackRun(aircraft, aircraft.attackRun, type);
      } else if (!type.rotary) {
        // A helicopter holds its position; anything else has to keep flying.
        steer(aircraft, orbitHeading(aircraft, center, orbitRadius(aircraft.order, type)), type);
      }
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
        aircraft.gunBursts = type.gunBursts;
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
  if (!seeksTargets(aircraft)) return () => 1;
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
  weather: Weather,
  boost: (t: GroundUnit) => number,
  tick: number,
): Observer {
  const type = typeOf(aircraft, air);
  return {
    id: aircraft.id,
    side: 'friendly',
    position: aircraft.position,
    medium: 'air',
    sees: (target) => airSightClear(terrain, weather, target.position, aircraft.position, aircraft.altitudeMeters, tick),
    rangeTo: (target) =>
      rangeInVisibility(
        type.sensorRadiusMeters,
        airVisibilityMeters(weather, target.position, aircraft.position, aircraft.altitudeMeters, tick),
        weather.clearVisibilityMeters,
      ),
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
function isNewSighting(estimate: ContactEstimate, tracked: readonly Vec2[], air: AirConfig): boolean {
  if (estimate.identification !== 'hostile') return false;
  return !tracked.some((center) => distance(center, estimate.position.center) <= air.sightingDedupeMeters);
}

/** Where air operations is already tracking hostiles from the air. */
function trackedFromAir(player: PlayerKnowledge, air: AirConfig, tick: number): Vec2[] {
  return Object.values(player.contacts).flatMap(({ contact, viaAircraft }) =>
    viaAircraft && contact.identification === 'hostile' && tick - contact.position.observedAt <= air.cueMaxAgeSeconds
      ? [contact.position.center]
      : [],
  );
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
    const observer = aircraftObserver(aircraft, air, terrain, truth.weather, cuedBoost(aircraft, player, air, tick), tick);
    let tracked: Vec2[] | null = null;
    for (const target of truth.units) {
      if (target.personnel <= 0) continue;
      const estimate = observeTarget(truth, observer, target, terrain, rng, perception, tick);
      if (estimate === null) continue;
      aircraft.contacts[estimate.contactId] = estimate;
      if (estimate.identification === 'friendly') {
        updateFriendly(player, target.platoonId, estimate.position, 'aircraft', tick, perception.contactMemorySeconds);
        if (estimate.activity === 'engaging') player.friendlyEngagedAt[target.platoonId] = tick;
        continue;
      }
      tracked ??= trackedFromAir(player, air, tick);
      const announce = isNewSighting(estimate, tracked, air);
      updateContact(player, estimate, tick, true);
      if (estimate.identification === 'hostile') tracked.push(estimate.position.center);
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

/** Friendly units on the controller's map too near this point, who haven't been cleared. */
function dangerClose(player: PlayerKnowledge, point: Vec2, meters: number, tick: number): boolean {
  return Object.values(player.friendlies).some((friendly) => {
    const clearedUntil = player.dangerCloseClearedUntil[friendly.unitId];
    if (clearedUntil !== undefined && tick <= clearedUntil) return false;
    return distance(friendly.position.center, point) <= meters;
  });
}

/** A strike aircraft cleared to pick its own targets in its area. */
function seeksTargets(aircraft: Aircraft): boolean {
  const kind = aircraft.order?.kind;
  return aircraft.aircraftType === 'cas' && aircraft.weapons !== 'hold' && (kind === 'Watch' || kind === 'Cover');
}

/** Confirmed hostiles the aircraft itself holds inside its assigned area, nearest first. */
function casCandidates(aircraft: Aircraft, center: Vec2, radius: number, memory: number, tick: number): readonly ContactEstimate[] {
  return Object.keys(aircraft.contacts)
    .sort()
    .flatMap((id) => {
      const contact = aircraft.contacts[id];
      if (contact === undefined || contact.identification !== 'hostile') return [];
      if (tick - contact.position.observedAt > memory) return [];
      return distance(contact.position.center, center) <= radius ? [contact] : [];
    })
    .sort((a, b) => distance(a.position.center, center) - distance(b.position.center, center));
}

function holdForFriendlies(aircraft: Aircraft, aim: Vec2, player: PlayerKnowledge, radio: RadioState, air: AirConfig, tick: number): void {
  aircraft.heldForFriendliesAt = tick;
  if (aircraft.heldReportAt !== null && tick - aircraft.heldReportAt < air.dangerCloseHoldReportSeconds) return;
  aircraft.heldReportAt = tick;
  player.log.push({ id: nextId(radio), kind: 'DANGER_CLOSE_HOLD', senderId: aircraft.id, observedAt: tick, sentAt: tick, receivedAt: tick, aim });
}

/** What the crew thinks it did: noisy, because nobody counts casualties from the air. */
function assessStrike(
  casualties: number,
  caught: readonly GroundUnit[],
  combat: CombatConfig,
  rng: RngState,
  label: string,
): StrikeAssessment {
  const noise = 1 + (nextFloat(rng, label) * 2 - 1) * combat.assessmentNoise;
  return { estimatedCasualties: Math.round(casualties * noise), destroyed: caught.filter((unit) => unit.side !== AIRCRAFT_SIDE).every((unit) => unit.personnel <= 0) };
}

/** How far a strike can catch neighbouring squads, in splash radii. */
const AIRCRAFT_SIDE = 'friendly';
const HOLD_PHASE_SECONDS = 30;

/** Men hit by their own side know it, and they say so at once. */
function reportFriendlyFire(
  truth: WorldTruth,
  caught: readonly GroundUnit[],
  effects: readonly CombatEffect[],
  radio: RadioState,
  tick: number,
): void {
  caught.forEach((unit, index) => {
    if (unit.side !== AIRCRAFT_SIDE) return;
    const casualties = effects[index]?.casualties ?? 0;
    truth.friendlyFireCasualties += casualties;
    const unitRadio = radio.units[unit.platoonId];
    if (unitRadio !== undefined) enqueue(unitRadio, { kind: 'CHECK_FIRE', contactId: null }, tick);
  });
}

/** The crew watches its pass land, so its next estimate is a new look, not the same error. */
function lookAgain(truth: WorldTruth, aircraft: Aircraft, contact: ContactEstimate): void {
  for (const track of Object.values(truth.tracks[aircraft.id] ?? {})) {
    if (track.contactId === contact.contactId) track.sampleRange = Number.MAX_SAFE_INTEGER;
  }
}

function strikePass(
  aircraft: Aircraft,
  aim: Vec2,
  contact: ContactEstimate | null,
  weapon: StrikeWeapon,
  nextPassSeconds: number,
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
  const model = typeOf(aircraft, air);
  const guns = weapon === 'guns';
  if (guns) aircraft.gunBursts -= 1;
  else aircraft.ammunition -= 1;
  const splash = guns ? air.gunSplashMeters : air.strikeSplashMeters;
  const casualtyFraction = guns ? model.gunCasualtyFraction : model.casualtyFractionPerPass;
  const suppressionPerPass = guns ? model.gunSuppression : model.suppressionPerPass;
  aircraft.nextPassTick = tick + Math.round(nextPassSeconds);
  const label = `air/${aircraft.id}/${contact?.contactId ?? 'area'}`;
  const height = Math.max(0, aircraft.altitudeMeters - elevationAt(terrain, aim));
  const local = weatherAt(truth.weather, aim, tick);
  const blur = hypot(height * model.strikeMissPerMeterAltitude, local.rain * truth.weather.rainMissMeters);
  const delivery = exp(-(blur * blur) / (2 * air.blastRadiusMeters * air.blastRadiusMeters));
  // Whoever is near the aiming point is hit, so spreading out is what reduces a strike (§4.0.1).
  const shareAt = (unit: GroundUnit): number => {
    const gap = distance(aim, unit.position);
    return delivery * exp(-(gap * gap) / (2 * splash * splash));
  };
  const caught = truth.units.filter(
    (unit) => unit.personnel > 0 && distance(aim, unit.position) <= splash * air.splashReach,
  );
  const strongest = new Map<string, number>();
  for (const unit of caught) strongest.set(unit.platoonId, Math.max(strongest.get(unit.platoonId) ?? 0, shareAt(unit)));
  const shaken = new Set<string>();
  const effects = caught.map((unit): CombatEffect => {
    const share = shareAt(unit);
    const cover = cellAt(terrain, unit.position).airCover;
    const first = !shaken.has(unit.platoonId);
    shaken.add(unit.platoonId);
    return {
      targetId: unit.id,
      casualties: nextBinomial(rng, `air/${aircraft.id}/${unit.id}`, unit.personnel, casualtyFraction * (1 - cover) * share),
      suppression: suppressionPerPass * share,
      // The shock falls once per platoon, as hard as the pass came to it.
      morale: first ? model.moralePerPass * (strongest.get(unit.platoonId) ?? 0) : 0,
    };
  });
  const casualties = effects.reduce((sum, effect) => sum + effect.casualties, 0);
  applyEffects(truth, effects, combat, rng, tick);
  reportFriendlyFire(truth, caught, effects, radio, tick);
  const accuracy = Math.max(0, ...strongest.values());
  if (contact !== null) lookAgain(truth, aircraft, contact);
  const effectObserved = nextBool(rng, label, accuracy);
  const assessment = effectObserved ? assessStrike(casualties, caught, combat, rng, label) : null;
  if (assessment !== null && contact !== null) recordStrike(player, contact, assessment, display.plausibleSpeedMps, tick);
  player.strikes.push({ aircraftId: aircraft.id, position: aim, tick, effectObserved });
  const message: RadioMessage = {
    id: nextId(radio),
    kind: 'STRIKE_RESULT',
    senderId: aircraft.id,
    observedAt: tick,
    sentAt: tick,
    receivedAt: tick,
    aim,
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
    const order = aircraft.order;
    if (aircraft.status !== 'onStation' || aircraft.aircraftType !== 'cas' || order === null || order.kind === 'ReturnToBase') continue;
    if (aircraft.breakSeconds > 0) continue;
    const run = aircraft.attackRun;
    if (run !== null) {
      if (run.phase === 'runIn') continueRun(aircraft, run, truth, player, radio, terrain, air, combat, display, rng, tick);
      continue;
    }
    if (order.kind === 'Suppress' || order.kind === 'Strike') {
      fireOnPlace(aircraft, order, truth, player, radio, terrain, air, combat, tick);
      continue;
    }
    if (!seeksTargets(aircraft)) continue;
    if ((aircraft.ammunition <= 0 && aircraft.gunBursts <= 0) || tick < aircraft.nextPassTick) continue;
    const { center, radius } = order;
    const candidates = casCandidates(aircraft, center, radius, engageMemorySeconds, tick);
    if (candidates.length === 0) continue;
    const near = (contact: ContactEstimate, weapon: StrikeWeapon): boolean =>
      dangerClose(player, contact.position.center, weapon === 'guns' ? air.gunDangerCloseMeters : air.dangerCloseMeters, tick);
    const attack = chooseAttack(crewSelf(aircraft, player, air, combat, tick), candidates, near);
    if (attack === null) {
      const [nearest] = candidates;
      if (nearest !== undefined && near(nearest, 'guns')) holdForFriendlies(aircraft, nearest.position.center, player, radio, air, tick);
      continue;
    }
    const { contact, weapon, nextPassSeconds } = attack;
    // The crew commits on its own estimate: whether it was right shows only in the result.
    if (!airSightClear(terrain, truth.weather, contact.position.center, aircraft.position, aircraft.altitudeMeters, tick)) continue;
    startRun(aircraft, contact.position.center, contact.contactId, weapon, nextPassSeconds, air);
  }
}

function startRun(aircraft: Aircraft, aim: Vec2, contactId: string | null, weapon: StrikeWeapon, nextPassSeconds: number, air: AirConfig): void {
  const type = typeOf(aircraft, air);
  aircraft.attackRun = {
    aim,
    contactId,
    weapon,
    phase: 'runIn',
    releaseAltitudeMeters: weapon === 'guns' ? air.gunRunHeightMeters : Math.max(type.minAltitudeMeters, aircraft.targetAltitudeMeters),
    pullOffSeconds: air.pullOffSeconds,
    nextPassSeconds,
  };
}

/** The task is done, or can't be done any more: the aircraft stays and watches the place. */
function watchInstead(aircraft: Aircraft, order: Extract<AircraftOrder, { kind: 'Suppress' | 'Strike' }>): void {
  aircraft.order = { kind: 'Watch', center: order.center, radius: order.radius };
}

/** Suppress and Strike: fire on a place the controller chose, with no target of the crew's own. */
function fireOnPlace(
  aircraft: Aircraft,
  order: Extract<AircraftOrder, { kind: 'Suppress' | 'Strike' }>,
  truth: WorldTruth,
  player: PlayerKnowledge,
  radio: RadioState,
  terrain: TerrainGrid,
  air: AirConfig,
  combat: CombatConfig,
  tick: number,
): void {
  const self = crewSelf(aircraft, player, air, combat, tick);
  const near = (point: Vec2, meters: number): boolean => dangerClose(player, point, meters, tick);
  // Fire on a place has no seen enemy to justify a risk, so it keeps friends out of its whole reach.
  const reach = Math.max(air.gunDangerCloseMeters, air.gunSplashMeters * air.splashReach);
  const pass = order.kind === 'Suppress' ? chooseSuppression(self, order, (point) => near(point, reach)) : chooseStrike(self, order);
  if (pass === 'done') {
    watchInstead(aircraft, order);
    return;
  }
  if (pass === null || tick < aircraft.nextPassTick) return;
  const meters = pass.weapon === 'guns' ? reach : air.dangerCloseMeters;
  if (dangerClose(player, pass.aim, meters, tick)) {
    holdForFriendlies(aircraft, pass.aim, player, radio, air, tick);
    return;
  }
  if (!airSightClear(terrain, truth.weather, pass.aim, aircraft.position, aircraft.altitudeMeters, tick)) return;
  startRun(aircraft, pass.aim, null, pass.weapon, pass.nextPassSeconds, air);
}

function continueRun(
  aircraft: Aircraft,
  run: AttackRun,
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
  if (distance(aircraft.position, run.aim) > (run.weapon === 'guns' ? air.gunReleaseMeters : air.releaseMeters)) return;
  const contact = run.contactId === null ? null : aircraft.contacts[run.contactId];
  const stillClear = !dangerClose(player, run.aim, run.weapon === 'guns' ? air.gunDangerCloseMeters : air.dangerCloseMeters, tick);
  const heightOk = run.weapon !== 'guns' || aircraft.altitudeMeters - elevationAt(terrain, run.aim) <= air.gunRunHeightMeters * air.gunHeightTolerance;
  aircraft.attackRun = { ...run, phase: 'pullOff' };
  if (contact === undefined || !stillClear || !heightOk) return;
  if (!airSightClear(terrain, truth.weather, run.aim, aircraft.position, aircraft.altitudeMeters, tick)) return;
  // On a target the crew aims where it now sees it; on a place, where it was told.
  const aim = contact === null ? run.aim : contact.position.center;
  strikePass(aircraft, aim, contact, run.weapon, run.nextPassSeconds, truth, player, radio, terrain, air, combat, display, rng, tick);
  if (aircraft.order?.kind === 'Strike') watchInstead(aircraft, aircraft.order);
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
      if (!airSightClear(terrain, truth.weather, unit.position, aircraft.position, aircraft.altitudeMeters, tick)) continue;
      if (nextBool(rng, `notice/${unit.id}/${aircraft.id}`, air.groundNoticePerScan)) {
        const belief = (knowledge[unit.platoonId] ??= emptyKnowledge());
        // A formation goes to ground when aircraft appear, then gets on with its attack:
        // an orbiting aircraft must not pin it indefinitely just by being there (§8.2).
        const lastCover = belief.hostileAircraftSeenAt;
        if (lastCover === null || tick - lastCover >= unit.doctrine.airCoverRepeatSeconds) {
          belief.hostileAircraftSeenAt = tick;
        }
        // Height above the unit: a weapon's reach is measured from where it stands.
        const altitudeMeters = Math.max(0, aircraft.altitudeMeters - elevationAt(terrain, unit.position));
        const label = `noticed/${unit.id}/${aircraft.id}`;
        const sigma = air.groundNoticeSigmaMeters;
        // Judged by eye, so what a unit decides to fire on is an estimate too.
        const position = {
          x: aircraft.position.x + nextGaussian(rng, label) * sigma,
          y: aircraft.position.y + nextGaussian(rng, label) * sigma,
        };
        belief.noticedAircraft = {
          position,
          altitudeMeters: Math.max(0, altitudeMeters + nextGaussian(rng, label) * sigma),
          seenAt: tick,
        };
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
function casPhase(aircraft: Aircraft, tick: number): CasPhase | null {
  const order = aircraft.order;
  if (aircraft.status !== 'onStation' || aircraft.aircraftType !== 'cas' || order === null || order.kind === 'ReturnToBase') return null;
  if (aircraft.ammunition <= 0 && aircraft.gunBursts <= 0) return 'out-of-ordnance';
  if (aircraft.breakSeconds > 0) return 'breaking-off';
  if (aircraft.attackRun !== null) return 'attack-run';
  if (aircraft.heldForFriendliesAt !== null && tick - aircraft.heldForFriendliesAt <= HOLD_PHASE_SECONDS) return 'holding-danger-close';
  if (order.kind === 'Suppress') return 'suppressing';
  if (aircraft.weapons === 'hold' && order.kind !== 'Strike') return 'weapons-hold';
  const { center, radius } = order;
  const inArea = Object.values(aircraft.contacts).filter((c) => distance(c.position.center, center) <= radius);
  if (inArea.some((contact) => contact.identification === 'hostile')) return 'target-acquired';
  return inArea.some((contact) => contact.identification === 'unidentified') ? 'identifying' : 'searching';
}

export function aircraftTelemetry(truth: WorldTruth, air: AirConfig, tick = 0): AircraftTelemetry {
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
      aboveCloud: isAirborne(aircraft) && aircraft.altitudeMeters > weatherAt(truth.weather, aircraft.position, tick).ceilingMeters,
      visibilityMeters: airVisibilityMeters(truth.weather, aircraft.position, aircraft.position, aircraft.altitudeMeters, tick),
      casPhase: casPhase(aircraft, tick),
      order: aircraft.order,
      fuelFraction: aircraft.fuelSeconds / type.fuelSeconds,
      ammunition: aircraft.ammunition,
      gunBursts: aircraft.gunBursts,
      risk: aircraft.risk,
      weapons: aircraft.weapons,
      manualAltitude: aircraft.manualAltitude,
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
