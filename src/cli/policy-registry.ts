import type { Vec2 } from '../domain/public/geometry';
import { immediateCas, noAir, reactiveCas, reconInformed, scoutingOnly, type Policy } from '../policies/air-policies';
import type { Scenario } from '../scenario/load';

const RECON_CLIMB_AFTER_FIRE_METERS = 1500;
// Below every hill, so pilots hug the terrain at their minimum clearance.
const CAS_TRANSIT_METERS = 100;

type PolicySet = Readonly<Record<string, () => Policy>>;

const BASELINE: PolicySet = { none: () => noAir, reactive: reactiveCas };

function outpostPolicies(scenario: Scenario): PolicySet {
  const objective = scenario.file.mission.area.center;
  return {
    ...BASELINE,
    immediate: immediateCas,
    informed: () => reconInformed(objective, true),
    informedNoForward: () => reconInformed(objective, false),
    informedBlind: () => reconInformed(objective, true, undefined, false),
    informedClimb: () => reconInformed(objective, true, undefined, false, RECON_CLIMB_AFTER_FIRE_METERS),
    informedWeather: () => reconInformed(objective, true, undefined, false, null, null, true),
    informedPopUp: () => reconInformed(objective, true, undefined, false, RECON_CLIMB_AFTER_FIRE_METERS, CAS_TRANSIT_METERS),
  };
}

/** Halfway between where the mission's units start and where they're going: the player's own plan. */
function routeMidpoint(scenario: Scenario): Vec2 {
  const start = scenario.file.units.find((unit) => unit.side === 'friendly')?.position ?? scenario.file.mission.area.center;
  const end = scenario.file.mission.area.center;
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

function valleyRoadPolicies(scenario: Scenario): PolicySet {
  const route = routeMidpoint(scenario);
  return {
    ...BASELINE,
    routeRecon: () => reconInformed(route, true),
    routeReconNoForward: () => reconInformed(route, false),
    scoutOnly: () => scoutingOnly(reconInformed(route, true)),
    scoutOnlyNoForward: () => scoutingOnly(reconInformed(route, false)),
  };
}

const SCENARIO_POLICIES: Readonly<Record<string, (scenario: Scenario) => PolicySet>> = {
  'outpost-under-pressure': outpostPolicies,
  'valley-road': valleyRoadPolicies,
};

// Shared by the batch runner and the debug page, so it must stay free of Node imports.
export function policies(scenario: Scenario): PolicySet {
  return SCENARIO_POLICIES[scenario.file.id]?.(scenario) ?? BASELINE;
}
