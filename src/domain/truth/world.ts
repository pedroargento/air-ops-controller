// Hidden ground truth. Only sim, perception, scenario, debug and cli may import this.
import type { AircraftId, AircraftOrder, AircraftStatus, AircraftType } from '../public/air';
import type { ContactActivity, ContactEstimate } from '../public/estimates';
import type { Vec2 } from '../public/geometry';
import type {
  Area,
  ContactId,
  Doctrine,
  GroundIntent,
  GroundMode,
  GroundObjective,
  GroundPosture,
  Side,
  UnitId,
} from '../public/ground';

export type GroundUnit = {
  id: UnitId;
  name: string;
  side: Side;
  position: Vec2;
  navOffset: Vec2;
  personnel: number;
  initialPersonnel: number;
  ammunition: number;
  initialAmmunition: number;
  morale: number;
  suppression: number;
  posture: GroundPosture;
  mode: GroundMode;
  returnsUsed: number;
  patrolIndex: number;
  objective: GroundObjective;
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
  position: Vec2;
  headingRad: number;
  status: AircraftStatus;
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
  captureProgressSeconds: number;
  outcome: Outcome;
  endedAtTick: number | null;
};
