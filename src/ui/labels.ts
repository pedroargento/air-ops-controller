// The words the interface shows for values the code names in its own way. Each table is a full
// record, so a new status or message kind doesn't compile until it has a label.
import type { AircraftStatus } from '../domain/public/air';
import type { RadioMessage } from '../domain/public/radio';

export const AIRCRAFT_STATUS_LABELS: Readonly<Record<AircraftStatus, string>> = {
  ready: 'Ready',
  takeoff: 'Taking off',
  enroute: 'En route',
  onStation: 'On station',
  returning: 'Returning',
  turnaround: 'Rearming',
};

export const MESSAGE_KIND_LABELS: Readonly<Record<RadioMessage['kind'], string>> = {
  ACKNOWLEDGEMENT: 'Acknowledged',
  CHECK_FIRE: 'Check fire',
  COMMAND_UPDATE: 'Command',
  CONTACT_REPORT: 'Contact',
  CREW_CALL: 'Crew call',
  DANGER_CLOSE_HOLD: 'Danger close',
  DRILL: 'Drill',
  GROUND_FIRE: 'Ground fire',
  INTEL_REPORT: 'Intel',
  MEDEVAC_ANSWER: 'Medevac answer',
  MEDEVAC_REQUEST: 'Medevac request',
  PICKUP_POINT: 'Pickup point',
  POI_REPORT: 'Point of interest',
  POSITION_REPORT: 'Position',
  SITREP: 'Sitrep',
  STRIKE_RESULT: 'Strike result',
  SUPPORT_REQUEST: 'Support request',
  SUPPRESSION: 'Suppression',
  TIC: 'Troops in contact',
};

/** A damaged aircraft is under repair when on the ground, and says so in the air. */
export function aircraftStatusLabel(status: AircraftStatus, damaged: boolean): string {
  if (!damaged) return AIRCRAFT_STATUS_LABELS[status];
  return status === 'turnaround' ? 'DAMAGED · repair' : 'DAMAGED';
}
