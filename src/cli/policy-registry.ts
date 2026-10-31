import { immediateCas, noAir, reactiveCas, reconInformed, type Policy } from '../policies/air-policies';
import type { Scenario } from '../scenario/load';

const RECON_CLIMB_AFTER_FIRE_METERS = 1500;
// Below every hill, so pilots hug the terrain at their minimum clearance.
const CAS_TRANSIT_METERS = 100;

// Shared by the batch runner and the debug page, so it must stay free of Node imports.
export function policies(scenario: Scenario): Readonly<Record<string, () => Policy>> {
  const objective = scenario.file.capture.area.center;
  return {
    none: () => noAir,
    reactive: reactiveCas,
    immediate: immediateCas,
    informed: () => reconInformed(objective, true),
    informedNoForward: () => reconInformed(objective, false),
    informedBlind: () => reconInformed(objective, true, undefined, false),
    informedClimb: () => reconInformed(objective, true, undefined, false, RECON_CLIMB_AFTER_FIRE_METERS),
    informedWeather: () => reconInformed(objective, true, undefined, false, null, null, true),
    informedPopUp: () => reconInformed(objective, true, undefined, false, RECON_CLIMB_AFTER_FIRE_METERS, CAS_TRANSIT_METERS),
  };
}
