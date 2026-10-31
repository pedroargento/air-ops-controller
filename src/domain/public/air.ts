import { distance, type Vec2 } from './geometry';

export type AircraftId = string & { readonly __brand: 'AircraftId' };
export type AircraftType = 'recon' | 'cas';
export type AircraftStatus = 'ready' | 'takeoff' | 'enroute' | 'onStation' | 'returning' | 'turnaround';

export type AircraftOrder =
  | Readonly<{ kind: 'MoveTo'; point: Vec2 }>
  | Readonly<{ kind: 'Orbit'; point: Vec2; radius: number }>
  | Readonly<{ kind: 'ReconArea'; center: Vec2; radius: number }>
  | Readonly<{ kind: 'SupportArea'; center: Vec2; radius: number }>
  | Readonly<{ kind: 'ReturnToBase' }>;

export type CasPhase = 'searching' | 'identifying' | 'target-acquired' | 'out-of-ordnance';

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
  casPhase: CasPhase | null;
  order: AircraftOrder | null;
  fuelFraction: number;
  ammunition: number;
  etaSeconds: number | null;
  availableInSeconds: number;
}>;

export type AircraftTelemetry = readonly AircraftTelemetryEntry[];

/** `CAS inbound` needs a real assignment covering, or near, where the unit last reported itself. */
export function qualifiesForSupport(
  entry: AircraftTelemetryEntry | undefined,
  reported: Vec2 | undefined,
  ackDistanceMeters: number,
): boolean {
  if (entry === undefined || reported === undefined) return false;
  if (entry.aircraftType !== 'cas' || entry.order?.kind !== 'SupportArea') return false;
  if (entry.status === 'returning' || entry.status === 'turnaround') return false;
  return distance(entry.order.center, reported) <= entry.order.radius + ackDistanceMeters;
}
