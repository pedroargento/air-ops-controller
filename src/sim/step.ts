import { decideGround, decidePlatoon } from '../ai/decide-ground';
import { assignRoles } from '../ai/drills';
import type { PlayerCommand } from '../domain/public/commands';
import { airWeapons, supportWeaponCount, totalAmmunition } from '../domain/public/equipment';
import { atan2 } from '../domain/public/det-math';
import { distance, moveToward, type Vec2 } from '../domain/public/geometry';
import {
  emptyKnowledge,
  type Drill,
  type DrillMap,
  type GroundObjective,
  type UnitKnowledge,
  type UnitSelf,
} from '../domain/public/ground';
import { cellAt, hasGroundLos, type TerrainGrid } from '../domain/public/terrain';
import { AIR_OPS, CECON, type MessageId } from '../domain/public/radio';
import type { GroundUnit, Platoon, WorldTruth } from '../domain/truth/world';
import { reviewContacts } from '../knowledge/player-knowledge';
import { correlateReports } from '../knowledge/tracks';
import { placeMarks } from './marks';
import { updatePerception } from '../perception/observe';
import { nextGaussian, type RngState } from '../rng/streams';
import type { Scenario } from '../scenario/load';
import type { PerceptionConfig } from '../scenario/schema';
import { advanceAircraft, crewCalls, updateCrews, resolveCas, sensorCoverage, updateAircraftNotice, updateAircraftPerception } from './air';
import { resolveGroundFire } from './ground-fire';
import { issueForecast } from './weather';
import { resolveCombat } from './combat';
import { updateOutcome } from './outcome';
import { advanceOutbound, applyCommand, reviewPromises } from './player-commands';
import { livingSquads, platoonOf, platoonPersonnel, platoonSelf, sortedPlatoons } from './platoon';
import { advanceRadio, enqueue, linkedNodes, planReports, type RadioUnit } from './radio';
import { findRoute, routeLength } from './route';
import type { SimState } from './state';

const TACTICAL_INTERVAL_TICKS = 5;
const DIRECT_MOVE_METERS = 150;
const UNDER_FIRE_TICKS = 15;

function selfView(unit: GroundUnit, platoon: Platoon, personnel: number, scenario: Scenario, tick: number): UnitSelf {
  const { terrain, file } = scenario;
  const config = file.perception;
  return {
    id: unit.id,
    side: unit.side,
    position: unit.position,
    slot: unit.slot,
    platoonPersonnel: personnel,
    ownPosition: {
      center: { x: unit.position.x + unit.navOffset.x, y: unit.position.y + unit.navOffset.y },
      sigmaMeters: config.navSigmaMeters,
      headingRad: null,
      speedMps: null,
      observedAt: tick,
    },
    personnel: unit.personnel,
    initialPersonnel: unit.initialPersonnel,
    ammunition: totalAmmunition(unit.equipment),
    initialAmmunition: unit.initialAmmunition,
    equipment: unit.equipment,
    supportWeapons: supportWeaponCount(unit.equipment, unit.personnel, file.combat.weapons),
    airWeapons: airWeapons(unit.equipment, unit.personnel, file.combat.weapons),
    morale: platoon.morale,
    suppression: unit.suppression,
    underFire: unit.lastHitAtTick !== null && tick - unit.lastHitAtTick <= UNDER_FIRE_TICKS,
    mode: platoon.mode,
    behavior: unit.behavior,
    behaviorSinceTick: unit.behaviorSinceTick,
    groundCover: cellAt(terrain, unit.position).groundCover,
    returnsUsed: platoon.returnsUsed,
    patrolIndex: unit.patrolIndex,
    squads: platoon.squads.length,
    drill: platoon.drill,
    role: unit.role,
    viaDone: unit.viaDone,
    ambushSprung: platoon.ambushSprung,
    handled: platoon.handled,
    routeAhead: unit.route,
    secondsLeft: file.durationSeconds - tick,
    canCallAir: linkedNodes(scenario, platoon.id).includes(AIR_OPS),
    objective: platoon.objective,
    fallback: platoon.fallback,
    doctrine: unit.doctrine,
  };
}

function squadViews(state: SimState, scenario: Scenario): ReadonlyMap<string, UnitSelf> {
  const { truth, tick } = state;
  const squads = new Map<string, UnitSelf>();
  for (const platoon of sortedPlatoons(truth)) {
    const personnel = platoonPersonnel(platoon);
    for (const unit of livingSquads(platoon)) squads.set(unit.id, selfView(unit, platoon, personnel, scenario, tick));
  }
  return squads;
}

type Selves = Readonly<{ squads: ReadonlyMap<string, UnitSelf>; platoons: ReadonlyMap<string, UnitSelf> }>;

function selfViews(state: SimState, scenario: Scenario, wanted?: (platoonId: string) => boolean): Selves {
  const { truth, tick } = state;
  const squads = new Map<string, UnitSelf>();
  const platoons = new Map<string, UnitSelf>();
  for (const platoon of sortedPlatoons(truth)) {
    if (wanted !== undefined && !wanted(platoon.id)) continue;
    const living = livingSquads(platoon);
    const personnel = platoonPersonnel(platoon);
    for (const unit of living) squads.set(unit.id, selfView(unit, platoon, personnel, scenario, tick));
    const self = platoonSelf(platoon, living, squads, scenario);
    if (self !== null) platoons.set(platoon.id, self);
  }
  return { squads, platoons };
}

/** The radio only needs a platoon's view at the moment it writes a report. */
function lazySelves(state: SimState, scenario: Scenario): Pick<ReadonlyMap<string, UnitSelf>, 'get'> {
  return { get: (id) => selfViews(state, scenario, (platoonId) => platoonId === id).platoons.get(id) };
}

/** Standing orders come from the scenario, or from a report; nothing in the sim chooses them. */
function changeObjective(platoon: Platoon, objective: GroundObjective): void {
  platoon.objective = objective;
  platoon.drill = null;
  for (const unit of platoon.squads) {
    unit.route = [];
    unit.routeDestination = null;
    unit.role = null;
  }
}

function reportedPosition(knowledge: UnitKnowledge, memory: number, tick: number): Vec2 | null {
  let newest: Vec2 | null = null;
  let newestAt = Number.NEGATIVE_INFINITY;
  for (const key of Object.keys(knowledge.reports).sort()) {
    const report = knowledge.reports[key];
    if (report === undefined || report.identification !== 'hostile') continue;
    if (tick - report.position.observedAt > memory || report.position.observedAt <= newestAt) continue;
    newest = report.position.center;
    newestAt = report.position.observedAt;
  }
  return newest;
}

function followOrders(state: SimState, platoon: Platoon, done: boolean): void {
  const { tick } = state;
  // Each finished objective starts only the next one in the schedule.
  let arrived = done;
  platoon.objectiveSchedule.forEach((entry, index) => {
    if (entry.kind === 'time') {
      if (entry.fromTick === tick) changeObjective(platoon, entry.objective);
      return;
    }
    if (platoon.ordersUsed.includes(index)) return;
    if (entry.kind === 'objectiveDone') {
      if (!arrived) return;
      arrived = false;
      platoon.ordersUsed = [...platoon.ordersUsed, index];
      changeObjective(platoon, entry.objective);
      return;
    }
    const knowledge = state.unitKnowledge[platoon.id] ?? emptyKnowledge();
    const center = reportedPosition(knowledge, platoon.doctrine.reportMemorySeconds, tick);
    if (center === null) return;
    platoon.ordersUsed = [...platoon.ordersUsed, index];
    changeObjective(platoon, { kind: 'AssaultArea', area: { center, radius: entry.radiusMeters } });
  });
}

function drillMap(terrain: TerrainGrid): DrillMap {
  return {
    routeMeters: (from, to, avoid) => routeLength(terrain, from, to, avoid),
    sees: (from, to) => hasGroundLos(terrain, from, to),
    cover: (point) => cellAt(terrain, point).groundCover,
  };
}

function startDrill(state: SimState, platoon: Platoon, drill: Drill): void {
  const squads = livingSquads(platoon);
  const roles = assignRoles(drill, platoon.doctrine, squads.map((unit) => distance(unit.position, drill.target)));
  for (const [index, unit] of squads.entries()) {
    unit.role = roles[index] ?? null;
    unit.viaDone = false;
    unit.routeDestination = null;
  }
  const radio = state.radio.units[platoon.id];
  if (radio !== undefined) enqueue(radio, { kind: 'DRILL', contactId: null, drill: drill.kind }, state.tick);
}

function endDrill(platoon: Platoon): void {
  for (const unit of platoon.squads) {
    unit.role = null;
    unit.routeDestination = null;
  }
}

function applyPlatoonDecisions(state: SimState, selves: ReadonlyMap<string, UnitSelf>, scenario: Scenario): void {
  const map = drillMap(scenario.terrain);
  for (const platoon of sortedPlatoons(state.truth)) {
    const self = selves.get(platoon.id);
    if (self === undefined || state.tick < platoon.activeFromTick) {
      followOrders(state, platoon, false);
      continue;
    }
    const decision = decidePlatoon(self, state.unitKnowledge[platoon.id] ?? emptyKnowledge(), state.tick, map);
    platoon.mode = decision.mode;
    platoon.returnsUsed = decision.returnsUsed;
    platoon.handled = decision.handled;
    platoon.fallback = decision.fallback;
    if (decision.ambushSprung && !platoon.ambushSprung) platoon.ambushSprungAt = state.tick;
    platoon.ambushSprung = decision.ambushSprung;
    const previous = platoon.drill;
    platoon.drill = decision.drill;
    if (decision.drill !== null && decision.drill !== previous) startDrill(state, platoon, decision.drill);
    else if (decision.drill === null && previous !== null) endDrill(platoon);
    followOrders(state, platoon, decision.objectiveDone);
  }
}

function applyDecisions(state: SimState, selves: ReadonlyMap<string, UnitSelf>, scenario: Scenario): void {
  const map = drillMap(scenario.terrain);
  for (const unit of state.truth.units) {
    const self = selves.get(unit.id);
    const platoon = platoonOf(state.truth, unit);
    if (self === undefined || unit.personnel <= 0 || state.tick < platoon.activeFromTick) continue;
    const knowledge = state.unitKnowledge[unit.platoonId] ?? emptyKnowledge();
    const decision = decideGround(self, knowledge, state.tick, scenario.file.combat.behaviorFireRate, map);
    unit.intent = decision.intent;
    unit.behavior = decision.behavior;
    unit.behaviorSinceTick = decision.behaviorSinceTick;
    unit.firesAtAircraft = decision.firesAtAircraft;
    unit.patrolIndex = decision.patrolIndex;
    unit.viaDone = decision.viaDone;
    unit.avoid = decision.avoid;
    unit.posture = postureFor(unit);
    unit.facingRad = facingOf(unit, platoon);
  }
}

/** What the radio needs of a platoon: its totals, and its lead squad's situation. */
function radioUnits(truth: WorldTruth): readonly RadioUnit[] {
  return sortedPlatoons(truth).map((platoon) => {
    const squads = livingSquads(platoon);
    const lead = squads[0] ?? null;
    return {
      id: platoon.id,
      personnel: platoonPersonnel(platoon),
      mode: platoon.mode,
      suppression: lead?.suppression ?? 0,
      intent: lead?.intent ?? { kind: 'wait' },
    };
  });
}

/** Which way a squad looks: where it's going, where it's shooting, or the ground it covers. */
function facingOf(unit: GroundUnit, platoon: Platoon): number {
  const toward = (point: Vec2): number => atan2(point.y - unit.position.y, point.x - unit.position.x);
  const destination = destinationOf(unit);
  if (destination !== null) return toward(destination);
  if (unit.intent.kind !== 'engage') {
    const { objective } = platoon;
    return objective.kind === 'AmbushArea' && objective.watches !== undefined ? toward(objective.watches) : unit.facingRad;
  }
  return toward(unit.intent.aim);
}

function postureFor(unit: GroundUnit): GroundUnit['posture'] {
  switch (unit.intent.kind) {
    case 'wait':
      return 'defending';
    case 'hold':
      return unit.intent.posture;
    case 'move':
      return 'moving';
    case 'engage':
      if (unit.intent.closeTo !== null) return 'moving';
      return unit.intent.prepared ? 'defending' : 'firing';
  }
}

function destinationOf(unit: GroundUnit): Vec2 | null {
  switch (unit.intent.kind) {
    case 'move':
      return unit.intent.destination;
    case 'engage':
      return unit.intent.closeTo;
    case 'wait':
    case 'hold':
      return null;
  }
}

function moveUnit(unit: GroundUnit, terrain: TerrainGrid): void {
  const destination = destinationOf(unit);
  if (destination === null || unit.personnel <= 0) return;

  const changed =
    unit.routeDestination === null || distance(unit.routeDestination, destination) > 1 || unit.routeAvoid !== unit.avoid;
  if (changed) {
    unit.route =
      unit.avoid === null && distance(unit.position, destination) <= DIRECT_MOVE_METERS
        ? [destination]
        : findRoute(terrain, unit.position, destination, unit.avoid);
    unit.routeDestination = destination;
    unit.routeAvoid = unit.avoid;
  }

  const speed =
    (unit.doctrine.speedMps * (1 - unit.suppression)) / cellAt(terrain, unit.position).moveCost;
  const start = unit.position;
  let remaining = speed;
  while (remaining > 0 && unit.route.length > 0) {
    const waypoint = unit.route[0] as Vec2;
    const gap = distance(unit.position, waypoint);
    unit.position = moveToward(unit.position, waypoint, remaining);
    remaining -= gap;
    if (remaining >= 0) unit.route.shift();
  }
  unit.navMeters += distance(start, unit.position);
}

// Navigation error changes only with movement, so a stationary unit keeps reporting the same error.
function driftNavigation(unit: GroundUnit, config: PerceptionConfig, rng: RngState): void {
  const moved = unit.navMeters;
  if (moved <= 0) return;
  unit.navMeters = 0;
  const label = `nav/${unit.id}`;
  const scale = Math.sqrt(moved) * config.navDriftPerMeter;
  const limit = config.navSigmaMeters * 2;
  const clamp = (value: number): number => Math.max(-limit, Math.min(limit, value));
  unit.navOffset = {
    x: clamp(unit.navOffset.x + nextGaussian(rng, label) * scale),
    y: clamp(unit.navOffset.y + nextGaussian(rng, label) * scale),
  };
}

/** Forecasts reach the player as CECON updates, so a plan can be overtaken by a new one. */
function publishForecast(state: SimState, scenario: Scenario): void {
  const { truth, player, radio, rng, tick } = state;
  player.forecast = issueForecast(truth.weather, scenario.file.weather, rng, tick);
  player.forecastIssuedAt = tick;
  radio.nextMessageNumber += 1;
  player.log.push({
    id: `M-${radio.nextMessageNumber}` as MessageId,
    kind: 'COMMAND_UPDATE',
    senderId: CECON,
    observedAt: tick,
    sentAt: tick,
    receivedAt: tick,
    text: 'Weather forecast updated.',
  });
}

// Fixed phase order (§10.3). Units are kept sorted by ID, so iteration is stable.
export function step(state: SimState, commands: readonly PlayerCommand[], scenario: Scenario): SimState {
  const { truth, rng } = state;
  if (truth.outcome !== 'running') return state;
  const { terrain, file } = scenario;
  const tactical = state.tick % TACTICAL_INTERVAL_TICKS === 0;

  for (const command of commands) applyCommand(state, command, scenario);

  if (state.tick % file.weather.forecastIntervalSeconds === 0) publishForecast(state, scenario);

  if (tactical) {
    updatePerception(truth, state.unitKnowledge, terrain, rng, file.perception, state.tick);
    updateAircraftPerception(truth, state.player, state.radio, terrain, rng, file.perception, file.air, state.tick);
    updateAircraftNotice(truth, state.unitKnowledge, file.air, terrain, rng, state.tick);
    const selves = selfViews(state, scenario);
    applyPlatoonDecisions(state, selves.platoons, scenario);
    // Squads act on what their platoon has just decided.
    applyDecisions(state, squadViews(state, scenario), scenario);
    planReports(radioUnits(truth), selves.platoons, state.unitKnowledge, state.radio, scenario, state.tick);
  }

  if (tactical) updateCrews(truth, state.player, file.air, file.combat, state.tick);
  for (const unit of truth.units) {
    moveUnit(unit, terrain);
    if (tactical) driftNavigation(unit, file.perception, rng);
  }
  for (const aircraft of truth.aircraft) advanceAircraft(aircraft, file.air, terrain);
  if (tactical) crewCalls(truth, state.player, state.radio, file.air, state.tick);
  if (tactical) placeMarks(truth, state.unitKnowledge, scenario, rng, state.tick);

  resolveCas(truth, state.player, state.radio, terrain, file.air, file.combat, file.display, file.perception.engageMemorySeconds, rng, state.tick);

  if (tactical) {
    resolveCombat(truth, terrain, file.combat, rng, state.tick);
    resolveGroundFire(truth, state.player, state.radio, file.combat, file.air, terrain, rng, state.tick);
    reviewContacts(state.player, sensorCoverage(truth, file.air), file.display, TACTICAL_INTERVAL_TICKS, state.tick);
  }

  advanceRadio(radioUnits(truth), lazySelves(state, scenario), state.unitKnowledge, state.radio, state.player, scenario, state.tick);
  advanceOutbound(state);
  // Whatever reached air operations this second goes on a track before anyone looks at the map.
  correlateReports(state.player, file.display, state.tick);
  if (tactical) reviewPromises(state, scenario);

  state.tick += 1;
  updateOutcome(truth, file.mission, file.durationSeconds, state.tick, state.player);
  return state;
}
