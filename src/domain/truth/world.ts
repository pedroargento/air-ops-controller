// Hidden ground truth. Only sim, perception, scenario, debug and cli may import this.
import type { AircraftId, AircraftOrder, AircraftStatus, AircraftType } from '../public/air';
import type { Equipment, WeaponType } from '../public/equipment';
import type { ContactActivity, ContactEstimate } from '../public/estimates';
import type { Weather } from '../public/weather';
import type { Vec2 } from '../public/geometry';
import type {
  Area,
  ContactId,
  Doctrine,
  GroundBehavior,
  GroundIntent,
  GroundMode,
  GroundObjective,
  GroundPosture,
  Side,
  UnitId,
} from '../public/ground';

// An authored change of standing orders, from the scenario file (§11).
export type ScheduledObjective = Readonly<{ fromTick: number; objective: GroundObjective }>;

export type GroundUnit = {
  id: UnitId;
  name: string;
  side: Side;
  position: Vec2;
  navOffset: Vec2;
  personnel: number;
  initialPersonnel: number;
  equipment: Equipment[];
  initialAmmunition: number;
  firedWeapons: readonly WeaponType[];
  firesAtAircraft: boolean;
  nextAirFireTick: number;
  morale: number;
  suppression: number;
  posture: GroundPosture;
  mode: GroundMode;
  behavior: GroundBehavior | null;
  behaviorSinceTick: number;
  returnsUsed: number;
  patrolIndex: number;
  objective: GroundObjective;
  objectiveSchedule: readonly ScheduledObjective[];
  fallback: Area;
  doctrine: Doctrine;
  activeFromTick: number;
  intent: GroundIntent;
  route: Vec2[];
  routeDestination: Vec2 | null;
  lastFiredAtTick: number | null;
  lastHitAtTick: number | null;
};

/**
 * Sim-only link between an observer and a true unit (§5.1), so repeat detections
 * update the same local track. The true anchor and error never leave simulation code.
 */
export type Track = {
  contactId: ContactId;
  anchor: Vec2;
  errorOffset: Vec2;
  lastActivity: ContactActivity;
  lastSeenPosition: Vec2;
  lastSeenTick: number;
  estimate: ContactEstimate;
};

export type Aircraft = {
  id: AircraftId;
  aircraftType: AircraftType;
  model: string;
  position: Vec2;
  altitudeMeters: number;
  targetAltitudeMeters: number;
  headingRad: number;
  status: AircraftStatus;
  damaged: boolean;
  lastFiredOnTick: number | null;
  order: AircraftOrder | null;
  timerSeconds: number;
  fuelSeconds: number;
  ammunition: number;
  nextPassTick: number;
  contacts: Record<string, ContactEstimate>;
};

export type Outcome = 'running' | 'held' | 'heldBelowStrength' | 'captured';

export type WorldTruth = {
  units: GroundUnit[];
  aircraft: Aircraft[];
  tracks: Record<string, Record<string, Track>>;
  nextContactNumber: number;
  weather: Weather;
  captureProgressSeconds: number;
  outcome: Outcome;
  endedAtTick: number | null;
};
