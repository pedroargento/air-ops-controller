import type { ContactEstimate } from './estimates';
import type { WeaponType } from './equipment';
import { distance, type Vec2 } from './geometry';
import type { Weather } from './weather';

export type AircraftId = string & { readonly __brand: 'AircraftId' };
export type AircraftType = 'recon' | 'cas';
export type AircraftStatus = 'ready' | 'takeoff' | 'enroute' | 'onStation' | 'returning' | 'turnaround';

/**
 * What the controller tasks an aircraft with (§8.0). Every task except going home has a
 * center the aircraft works over and a radius it works within.
 * - Watch: be over the area. Recon searches it; strike aircraft engage what they find there,
 *   as far as their weapons control allows.
 * - Cover: watch the ground ahead of a friendly platoon, as the controller's map shows it.
 *   The center follows the platoon.
 * - Suppress: gun runs on the area until `untilTick`, with no target needed.
 * - Strike: one heavy pass on the center, then watch it.
 * - Illuminate: keep a flare burning over the center until `untilTick`, then watch it (§8.7).
 * - Pickup: land on the center and wait while survivors board (§8.8). Helicopters with seats only.
 */
export type AircraftOrder =
  | Readonly<{ kind: 'Watch'; center: Vec2; radius: number }>
  | Readonly<{ kind: 'Cover'; unitId: string; center: Vec2; radius: number }>
  | Readonly<{ kind: 'Suppress'; center: Vec2; radius: number; untilTick: number }>
  | Readonly<{ kind: 'Strike'; center: Vec2; radius: number }>
  | Readonly<{ kind: 'Illuminate'; center: Vec2; radius: number; untilTick: number }>
  | Readonly<{ kind: 'Pickup'; center: Vec2; radius: number }>
  | Readonly<{ kind: 'ReturnToBase' }>;

export type TaskOrder = Exclude<AircraftOrder, Readonly<{ kind: 'ReturnToBase' }>>;

/** How much risk the controller accepts on this aircraft (§8.0). */
export type RiskLimit = 'cautious' | 'normal' | 'pressOn';

export type StrikeWeapon = 'heavy' | 'guns';

/** What a ground unit asks for, or what a crew may use. */
export type SupportWeapons = 'heavy' | 'guns' | 'both';

/**
 * What a crew may fire on its own judgment, set per aircraft (§8.0). Hold means it never
 * picks its own targets. A Suppress or Strike order is the controller's own call, so it fires
 * whatever this says.
 */
export type WeaponsControl = 'hold' | SupportWeapons;

/** Ground fire as the crew judged it: an estimated source, and the weapon if they saw it. */
export type FiredOn = Readonly<{ center: Vec2; tick: number; weapon: WeaponType | null; hit: boolean }>;

export type AttackRun = Readonly<{
  aim: Vec2;
  /** Null when firing on a place rather than on something the crew can see. */
  contactId: string | null;
  weapon: StrikeWeapon;
  /** Extending away to where the run starts, flying it, then leaving (§8.10). */
  phase: 'extend' | 'runIn' | 'pullOff';
  /** Where the crew chose to start its run from, and how far from the aim that is. */
  rollIn: Vec2;
  rollInMeters: number;
  releaseAltitudeMeters: number;
  pullOffSeconds: number;
  nextPassSeconds: number;
}>;

/** What to hit, with what, and how long until the next pass. */
export type CrewAttack = Readonly<{ contact: ContactEstimate; weapon: StrikeWeapon; nextPassSeconds: number }>;

/** Everything a crew knows when it decides. None of it is truth. */
export type CrewSelf = Readonly<{
  tick: number;
  role: AircraftType;
  rotary: boolean;
  status: AircraftStatus;
  order: AircraftOrder | null;
  destination: Vec2 | null;
  position: Vec2;
  risk: RiskLimit;
  weapons: WeaponsControl;
  manualAltitude: boolean;
  defaultAltitudeMeters: number;
  minAltitudeMeters: number;
  maxAltitudeMeters: number;
  ammunition: number;
  gunBursts: number;
  /** A hand-set altitude can rule out a low gun run. */
  gunsReachable: boolean;
  /** Seconds it can stay before it has to head home. */
  enduranceSeconds: number;
  passIntervalSeconds: number;
  gunPassFactor: number;
  firedOn: readonly FiredOn[];
  contacts: readonly ContactEstimate[];
  forecast: Weather | null;
  weaponCeilings: Readonly<Record<WeaponType, number>>;
  threatMemorySeconds: number;
  breakReactionSeconds: number;
  searchLeg: number;
  searchPoint: Vec2 | null;
  attackRun: AttackRun | null;
  tuning: CrewTuning;
}>;

/** The crew's rules of thumb, from the rules file's `air` section. */
export type CrewTuning = Readonly<{
  cloudMarginMeters: number;
  rainSightShare: number;
  threatStandoffMeters: number;
  searchReachedMeters: number;
  searchLegs: number;
  searchRingShare: number;
  suppressSpreadShare: number;
}>;

export type CrewDecision = Readonly<{
  altitudeMeters: number | null;
  breakFrom: Vec2 | null;
  searchPoint: Vec2 | null;
  searchLeg: number;
}>;

export type CasPhase =
  | 'searching'
  | 'identifying'
  | 'target-acquired'
  | 'attack-run'
  | 'breaking-off'
  | 'holding-danger-close'
  | 'suppressing'
  | 'weapons-hold'
  | 'out-of-ordnance';

export type AircraftTelemetryEntry = Readonly<{
  aircraftId: AircraftId;
  aircraftType: AircraftType;
  model: string;
  rotary: boolean;
  position: Vec2;
  altitudeMeters: number;
  targetAltitudeMeters: number;
  headingRad: number;
  status: AircraftStatus;
  damaged: boolean;
  /** Heavily damaged: it will not fly again in this scenario. */
  outOfAction: boolean;
  aboveCloud: boolean;
  /** What the crew reports from where they are, so it's their own observation, not the plan. */
  visibilityMeters: number;
  casPhase: CasPhase | null;
  order: AircraftOrder | null;
  fuelFraction: number;
  ammunition: number;
  gunBursts: number;
  risk: RiskLimit;
  weapons: WeaponsControl;
  manualAltitude: boolean;
  etaSeconds: number | null;
  availableInSeconds: number;
  /** Time it can stay once there before it must head home, while airborne and not already going. */
  stationSeconds: number | null;
  /** Flying time back to base from where it is. */
  homeSeconds: number;
  /** Time on the ground before it can fly again: rearming, or repair if damaged. */
  turnaroundSeconds: number;
  speedMps: number;
  /** Time still to take off: the whole takeoff while ready, what's left during it, then none. */
  takeoffSeconds: number;
  flares: number;
  seats: number;
  /** On the ground at a pickup point, and how far boarding has got. */
  landed: boolean;
  boardingSeconds: number;
  boardNeedSeconds: number;
  passengers: number;
  /** How far the survivor running for it is, as the crew sees it, or null if nobody is coming. */
  survivorMeters: number | null;
  /** Wounded aboard, and while landed, wounded the crew sees waiting within reach (§8.9). */
  woundedAboard: number;
  woundedInReach: number | null;
}>;

export type AircraftTelemetry = readonly AircraftTelemetryEntry[];

/** `CAS inbound` needs a real assignment covering, or near, where the unit last reported itself. */
export function qualifiesForSupport(
  entry: AircraftTelemetryEntry | undefined,
  reported: Vec2 | undefined,
  ackDistanceMeters: number,
): boolean {
  if (entry === undefined || reported === undefined) return false;
  if (entry.aircraftType !== 'cas' || entry.order === null || entry.order.kind === 'ReturnToBase') return false;
  if (entry.status === 'returning' || entry.status === 'turnaround') return false;
  // An aircraft on hold over the area isn't support, but one told to suppress or strike is.
  if (entry.weapons === 'hold' && (entry.order.kind === 'Watch' || entry.order.kind === 'Cover')) return false;
  return distance(entry.order.center, reported) <= entry.order.radius + ackDistanceMeters;
}
