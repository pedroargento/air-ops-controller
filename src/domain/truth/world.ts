// Hidden ground truth. Only sim, perception, scenario, debug and cli may import this.
import type { AircraftId, AircraftOrder, AircraftStatus, AircraftType, AttackRun, FiredOn, RiskLimit, WeaponsControl } from '../public/air';
import type { CrewCallKind } from '../public/radio';
import type { Flare } from '../public/light';
import type { Equipment, WeaponType } from '../public/equipment';
import type { ContactActivity, ContactEstimate } from '../public/estimates';
import type { Weather } from '../public/weather';
import type { Vec2 } from '../public/geometry';
import type {
  Area,
  ContactId,
  Doctrine,
  Drill,
  DrillPhase,
  DrillWaitReason,
  GroundVolley,
  GroundBehavior,
  GroundIntent,
  GroundMode,
  GroundObjective,
  GroundPosture,
  HandledPosition,
  Side,
  SquadRole,
  UnitId,
} from '../public/ground';

// An authored change of standing orders, from the scenario file (§11).
export type ScheduledObjective =
  | Readonly<{ kind: 'time'; fromTick: number; objective: GroundObjective }>
  | Readonly<{ kind: 'objectiveDone'; objective: GroundObjective }>
  | Readonly<{ kind: 'contactReported'; radiusMeters: number }>;

/** A command relationship between squads (§4.0.1): nothing here has a position. */
export type Platoon = {
  id: UnitId;
  name: string;
  side: Side;
  squads: readonly GroundUnit[];
  initialPersonnel: number;
  initialAmmunition: number;
  morale: number;
  mode: GroundMode;
  returnsUsed: number;
  /** When it last marked a target for air, so it doesn't throw smoke every few seconds. */
  lastMarkAt?: number;
  illuminationFired?: number;
  lastIlluminationAt?: number;
  /** A downed aircrew's state, for the platoon that is one (§8.8). */
  survival?: Survival;
  /** Standing to on intelligence from air operations until this tick: halted where it is (§6.5). */
  standToUntil?: number;
  objective: GroundObjective;
  objectiveSchedule: readonly ScheduledObjective[];
  /** Positions in `objectiveSchedule` that have already fired. */
  ordersUsed: readonly number[];
  fallback: Area;
  doctrine: Doctrine;
  activeFromTick: number;
  drill: Drill | null;
  drillPhase: DrillPhase | null;
  /** Diagnostic output only; omitted from UnitSelf. */
  drillWaitReason: DrillWaitReason | null;
  ambushSprung: boolean;
  ambushSprungAt: number | null;
  handled: readonly HandledPosition[];
};

/** The smallest simulated combat unit. Orders and morale belong to its platoon. */
export type GroundUnit = {
  groundVolley: GroundVolley | null;
  id: UnitId;
  platoonId: UnitId;
  slot: Vec2;
  name: string;
  side: Side;
  position: Vec2;
  facingRad: number;
  navOffset: Vec2;
  /** Metres walked since the navigation error last drifted. */
  navMeters: number;
  personnel: number;
  initialPersonnel: number;
  equipment: Equipment[];
  initialAmmunition: number;
  firedWeapons: readonly WeaponType[];
  firesAtAircraft: boolean;
  nextAirFireTick: number;
  suppression: number;
  posture: GroundPosture;
  behavior: GroundBehavior | null;
  behaviorSinceTick: number;
  patrolIndex: number;
  doctrine: Doctrine;
  role: SquadRole | null;
  viaDone: boolean;
  avoid: Area | null;
  routeAvoid: Area | null;
  intent: GroundIntent;
  route: Vec2[];
  routeDestination: Vec2 | null;
  lastFiredAtTick: number | null;
  lastHitAtTick: number | null;
  /** Squads that fired at it, and when they last did. It feels the fire; it may not see who (§7.3). */
  shotBy: Record<string, number>;
  /** When it last lost men. */
  lastLossAtTick: number | null;
  /** Wounded carried with the squad, grouped by when they were hit (§4.1.1). */
  wounded: WoundedGroup[];
};

/** Men wounded at the same moment: they have waited equally long. */
export type WoundedGroup = { count: number; since: number };

/** What really happened to one side's men, for the debrief (§8.9). */
export type CasualtyLedger = {
  killed: number;
  wounded: number;
  diedOfWounds: number;
  evacuated: number;
  /** Seconds from wound to hospital, summed over everyone evacuated. */
  hospitalSeconds: number;
};

/**
 * Sim-only link between an observer and a true unit (§5.1), so repeat detections
 * update the same local track. The true anchor and error never leave simulation code.
 */
export type Track = {
  contactId: ContactId;
  anchor: Vec2;
  /** How far off the observer was on the last real look. */
  sampleRange: number;
  errorOffset: Vec2;
  lastActivity: ContactActivity;
  lastSeenPosition: Vec2;
  lastSeenTick: number;
  estimate: ContactEstimate;
  /** The head count the observer last saw, which its claims are measured against. */
  seenPersonnel?: number;
  claimed?: number;
};

export type AircraftRecord = {
  airborneSeconds: number; stationSeconds: number; landedSeconds: number;
  damageIncidents: number; repairSeconds: number;
  bombs: number; gunBursts: number; flares: number; illuminationSeconds: number;
  enemyCasualties: number; friendlyCasualties: number;
  observedSquads: string[]; firstAirSightings: number;
  observationSamples: number; observationErrorMeters: number;
  woundedDelivered: number; hospitalSeconds: number; survivorsDelivered: number;
  sorties: { departedAt: number; returnedAt: number | null }[];
};

export type Aircraft = {
  /** Truth-only accounting for the mission report. Never used for decisions. */
  record: AircraftRecord;
  id: AircraftId;
  aircraftType: AircraftType;
  model: string;
  position: Vec2;
  altitudeMeters: number;
  targetAltitudeMeters: number;
  headingRad: number;
  status: AircraftStatus;
  damaged: boolean;
  /** Heavily damaged: once landed it is not repaired within the scenario (§8.3). */
  outOfAction: boolean;
  lastFiredOnTick: number | null;
  heldForFriendliesAt: number | null;
  heldReportAt: number | null;
  order: AircraftOrder | null;
  timerSeconds: number;
  fuelSeconds: number;
  ammunition: number;
  /** What it is loaded with at the airbase. */
  bombLoad: number;
  flares: number;
  /** On the ground at a pickup point, and for how long someone has been boarding. */
  landed: boolean;
  boardingSeconds: number;
  /** Platoons aboard. */
  passengers: string[];
  /** Wounded aboard, with when each group was hit (§8.9). */
  casualtiesAboard: WoundedGroup[];
  /** Wounded loaded so far, counted per second, so partial loads carry over. */
  loadProgress: number;
  gunBursts: number;
  nextPassTick: number;
  risk: RiskLimit;
  weapons: WeaponsControl;
  /** Fuel and ordnance calls already made this sortie, so each is said once. */
  calls: CrewCallKind[];
  manualAltitude: boolean;
  firedOn: readonly FiredOn[];
  breakSeconds: number;
  breakPoint: Vec2 | null;
  searchLeg: number;
  searchPoint: Vec2 | null;
  attackRun: AttackRun | null;
  contacts: Record<string, ContactEstimate>;
};

export type Survival = {
  waterSeconds: number;
  thirstSeconds: number;
  battery: number;
  state: 'evading' | 'aboard' | 'delivered' | 'captured' | 'dead';
  /** The helicopter it boarded. */
  aircraftId: string | null;
};

export type SmokeMark = Readonly<{ position: Vec2; placedAt: number; platoonId: string }>;

export type Outcome = 'running' | 'success' | 'partial' | 'failure';

export type WorldTruth = {
  platoons: Record<string, Platoon>;
  units: GroundUnit[];
  aircraft: Aircraft[];
  tracks: Record<string, Record<string, Track>>;
  nextContactNumber: number;
  weather: Weather;
  captureProgressSeconds: number;
  /** How much of the enemy the player had found, for a `LocateForce` mission. */
  locatedShare: number | null;
  /** Men lost to their own side's strikes. */
  friendlyFireCasualties: number;
  casualties: Record<'friendly' | 'enemy', CasualtyLedger>;
  /** Smoke thrown on targets for aircraft: a physical thing anyone nearby can see. */
  marks: SmokeMark[];
  /** Flares burning or burnt out: light anyone under them is seen by. */
  flares: Flare[];
  outcome: Outcome;
  endedAtTick: number | null;
};
