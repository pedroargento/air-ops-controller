import { decideGround } from '../ai/decide-ground';
import type { PlayerCommand } from '../domain/public/commands';
import { distance, moveToward, type Vec2 } from '../domain/public/geometry';
import { emptyKnowledge, type UnitSelf } from '../domain/public/ground';
import { cellAt, type TerrainGrid } from '../domain/public/terrain';
import type { GroundUnit } from '../domain/truth/world';
import { updatePerception } from '../perception/observe';
import { nextGaussian, type RngState } from '../rng/streams';
import type { Scenario } from '../scenario/load';
import type { PerceptionConfig } from '../scenario/schema';
import { advanceAircraft, resolveCas, updateAircraftNotice, updateAircraftPerception } from './air';
import { resolveCombat } from './combat';
import { updateOutcome } from './outcome';
import { advanceOutbound, applyCommand, reviewPromises } from './player-commands';
import { advanceRadio, planReports } from './radio';
import { findRoute } from './route';
import type { SimState } from './state';

const TACTICAL_INTERVAL_TICKS = 5;
const DIRECT_MOVE_METERS = 150;
const UNDER_FIRE_TICKS = 15;

function selfView(unit: GroundUnit, config: PerceptionConfig, tick: number): UnitSelf {
  return {
    id: unit.id,
    side: unit.side,
    position: unit.position,
    ownPosition: {
      center: { x: unit.position.x + unit.navOffset.x, y: unit.position.y + unit.navOffset.y },
      sigmaMeters: config.navSigmaMeters,
      headingRad: null,
      speedMps: null,
      observedAt: tick,
    },
    personnel: unit.personnel,
    initialPersonnel: unit.initialPersonnel,
    ammunition: unit.ammunition,
    initialAmmunition: unit.initialAmmunition,
    morale: unit.morale,
    suppression: unit.suppression,
    underFire: unit.lastHitAtTick !== null && tick - unit.lastHitAtTick <= UNDER_FIRE_TICKS,
    mode: unit.mode,
    returnsUsed: unit.returnsUsed,
    patrolIndex: unit.patrolIndex,
    objective: unit.objective,
    fallback: unit.fallback,
    doctrine: unit.doctrine,
  };
}

function selfViews(state: SimState, config: PerceptionConfig): ReadonlyMap<string, UnitSelf> {
  return new Map(state.truth.units.map((unit) => [unit.id, selfView(unit, config, state.tick)]));
}

function applyDecisions(state: SimState, selves: ReadonlyMap<string, UnitSelf>): void {
  for (const unit of state.truth.units) {
    const self = selves.get(unit.id);
    if (self === undefined || unit.personnel <= 0 || state.tick < unit.activeFromTick) continue;
    const knowledge = state.unitKnowledge[unit.id] ?? emptyKnowledge();
    const decision = decideGround(self, knowledge, state.tick);
    unit.intent = decision.intent;
    unit.mode = decision.mode;
    unit.returnsUsed = decision.returnsUsed;
    unit.patrolIndex = decision.patrolIndex;
    unit.posture = postureFor(unit);
  }
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
      return unit.intent.closeTo === null ? 'firing' : 'moving';
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

function moveUnit(unit: GroundUnit, terrain: TerrainGrid, config: PerceptionConfig, rng: RngState): void {
  const destination = destinationOf(unit);
  if (destination === null || unit.personnel <= 0) return;

  const changed =
    unit.routeDestination === null || distance(unit.routeDestination, destination) > 1;
  if (changed) {
    unit.route =
      distance(unit.position, destination) <= DIRECT_MOVE_METERS
        ? [destination]
        : findRoute(terrain, unit.position, destination);
    unit.routeDestination = destination;
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
  driftNavigation(unit, distance(start, unit.position), config, rng);
}

// Navigation error changes only with movement, so a stationary unit keeps reporting the same error.
function driftNavigation(unit: GroundUnit, moved: number, config: PerceptionConfig, rng: RngState): void {
  if (moved <= 0) return;
  const label = `nav/${unit.id}`;
  const scale = Math.sqrt(moved) * config.navDriftPerMeter;
  const limit = config.navSigmaMeters * 2;
  const clamp = (value: number): number => Math.max(-limit, Math.min(limit, value));
  unit.navOffset = {
    x: clamp(unit.navOffset.x + nextGaussian(rng, label) * scale),
    y: clamp(unit.navOffset.y + nextGaussian(rng, label) * scale),
  };
}

// Fixed phase order (§10.3). Units are kept sorted by ID, so iteration is stable.
export function step(state: SimState, commands: readonly PlayerCommand[], scenario: Scenario): SimState {
  const { truth, rng } = state;
  if (truth.outcome !== 'running') return state;
  const { terrain, file } = scenario;
  const tactical = state.tick % TACTICAL_INTERVAL_TICKS === 0;

  for (const command of commands) applyCommand(state, command, scenario);

  if (tactical) {
    updatePerception(truth, state.unitKnowledge, terrain, rng, file.perception, state.tick);
    updateAircraftPerception(truth, state.player, state.radio, terrain, rng, file.perception, file.air, state.tick);
    updateAircraftNotice(truth, state.unitKnowledge, file.air, rng, state.tick);
    const selves = selfViews(state, file.perception);
    applyDecisions(state, selves);
    planReports(truth.units, selves, state.unitKnowledge, state.radio, scenario, state.tick);
  }

  for (const unit of truth.units) moveUnit(unit, terrain, file.perception, rng);
  for (const aircraft of truth.aircraft) advanceAircraft(aircraft, file.air);

  resolveCas(truth, state.player, state.radio, terrain, file.air, file.combat, file.perception.engageMemorySeconds, rng, state.tick);

  if (tactical) resolveCombat(truth, state.unitKnowledge, terrain, file.combat, rng, state.tick);

  advanceRadio(truth.units, selfViews(state, file.perception), state.unitKnowledge, state.radio, state.player, scenario, state.tick);
  advanceOutbound(state);
  if (tactical) reviewPromises(state, scenario);

  state.tick += 1;
  updateOutcome(truth, file.capture, file.durationSeconds, state.tick);
  return state;
}
