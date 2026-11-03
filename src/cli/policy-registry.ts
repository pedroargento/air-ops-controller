import type { Vec2 } from '../domain/public/geometry';
import { answeringDangerClose, answeringRequests, atRisk, lingeringOnGuns, illuminatingAtNight, immediateCas, noAir, reactiveCas, markingKillZones, reconInformed, rescuing, scoutingOnly, suppressingKillZones, coveringLead, sweepingRecon, type Policy } from '../policies/air-policies';
import type { Scenario } from '../scenario/load';

type PolicySet = Readonly<Record<string, () => Policy>>;

const BASELINE: PolicySet = { none: () => noAir, reactive: () => reactiveCas() };

function outpostPolicies(scenario: Scenario): PolicySet {
  const objective = scenario.file.mission.area.center;
  return {
    ...BASELINE,
    immediate: immediateCas,
    informed: () => reconInformed(objective, true),
    informedNoForward: () => reconInformed(objective, false),
    informedLinger: () => lingeringOnGuns(reconInformed(objective, true)),
    informedCautious: () => atRisk(reconInformed(objective, true), 'cautious'),
    informedPressOn: () => atRisk(reconInformed(objective, true), 'pressOn'),
  };
}

/** The outpost's bots, each also in a version that keeps flares over the fight. */
function nightOutpostPolicies(scenario: Scenario): PolicySet {
  const day = outpostPolicies(scenario);
  return {
    ...day,
    reactiveLit: () => illuminatingAtNight(reactiveCas()),
    informedLit: () => illuminatingAtNight(reconInformed(scenario.file.mission.area.center, true)),
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
    routeReconMark: () => markingKillZones(reconInformed(route, true)),
    routeReconSuppress: () => suppressingKillZones(markingKillZones(reconInformed(route, true))),
    routeReconLinger: () => lingeringOnGuns(markingKillZones(reconInformed(route, true))),
    routeReconCover: () => coveringLead(reconInformed(route, true), scenario.file.mission.area.center),
    reactiveSuppress: () => reactiveCas(600),
    routeReconAnswer: () => answeringRequests(reconInformed(route, true)),
    scoutOnlyMark: () => markingKillZones(scoutingOnly(reconInformed(route, true))),
    scoutOnly: () => scoutingOnly(reconInformed(route, true)),
    scoutOnlyNoForward: () => scoutingOnly(reconInformed(route, false)),
  };
}

function findThemPolicies(scenario: Scenario): PolicySet {
  const size = scenario.terrain.width * scenario.terrain.cellSize;
  const center = { x: size / 2, y: size / 2 };
  const quarter = size / 4;
  const sectors = [
    { x: quarter, y: quarter },
    { x: 3 * quarter, y: quarter },
    { x: 3 * quarter, y: 3 * quarter },
    { x: quarter, y: 3 * quarter },
  ];
  return {
    none: () => noAir,
    oneOrbit: () => sweepingRecon([center], 1500, 600),
    sweep: () => sweepingRecon(sectors, 1200, 420),
  };
}

/** Danger close is a standing rule here: denied by default, with an approving variant to compare. */
function withDangerClose(set: PolicySet): PolicySet {
  const entries = Object.entries(set).flatMap(([name, make]): [string, () => Policy][] => [
    [name, () => answeringDangerClose(make(), false)],
    ...(name === 'none' ? [] : [[`${name}Approve`, () => answeringDangerClose(make(), true)] as [string, () => Policy]]),
  ]);
  return Object.fromEntries(entries);
}

function rescuePolicies(scenario: Scenario): PolicySet {
  const mission = scenario.file.mission;
  const survivor = mission.kind === 'Rescue' ? mission.survivorId : '';
  return {
    none: () => noAir,
    rescueNow: () => rescuing(survivor, false),
    rescueByDay: () => rescuing(survivor, true),
    rescueUnescorted: () => rescuing(survivor, false, false),
  };
}

const SCENARIO_POLICIES: Readonly<Record<string, (scenario: Scenario) => PolicySet>> = {
  'find-them': findThemPolicies,
  'outpost-under-pressure': outpostPolicies,
  'outpost-night': nightOutpostPolicies,
  'valley-road': valleyRoadPolicies,
  overwatch: valleyRoadPolicies,
  'downed-pilot': rescuePolicies,
};

// Shared by the batch runner and the debug page, so it must stay free of Node imports.
export function policies(scenario: Scenario): PolicySet {
  return withDangerClose(SCENARIO_POLICIES[scenario.file.id]?.(scenario) ?? BASELINE);
}
