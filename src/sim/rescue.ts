import type { ContactEstimate } from '../domain/public/estimates';
import type { ContactId } from '../domain/public/ground';
import { distance, type Vec2 } from '../domain/public/geometry';
import { emptyKnowledge, type UnitKnowledge } from '../domain/public/ground';
import type { CrewCallKind, MessageId, RadioMessage } from '../domain/public/radio';
import type { Aircraft, Platoon, WorldTruth } from '../domain/truth/world';
import type { PlayerKnowledge } from '../knowledge/player-knowledge';
import { nextGaussian, type RngState } from '../rng/streams';
import type { Scenario } from '../scenario/load';
import type { RadioState } from './radio';

/*
 * Combat search and rescue (§8.8): a downed aircrew evading with little water and a radio that
 * gives it away, hunters closing on what they know, and a helicopter that must land and wait
 * while it boards.
 */

type RescueMission = Extract<Scenario['file']['mission'], { kind: 'Rescue' }>;

const FIRE_RECENT_SECONDS = 2;
const SPOTTED_SECONDS = 30;
const HUNTER_STRENGTH = { kind: 'range', min: 1, max: 5 } as const;

function survivorOf(truth: WorldTruth, mission: RescueMission): Platoon | undefined {
  return truth.platoons[mission.survivorId];
}

/** An estimate of the survivor as hunters get it: the parachute they saw, or a radio fix. */
function fix(source: string, center: Vec2, sigma: number, tick: number): ContactEstimate {
  return {
    contactId: source as ContactId,
    provenance: { sourceId: source, observedAt: tick },
    identification: 'hostile',
    position: { center, sigmaMeters: sigma, headingRad: null, speedMps: null, observedAt: tick },
    strength: HUNTER_STRENGTH,
    kind: 'infantry',
    activity: 'unknown',
    confidence: 'low',
    observedWeapons: [],
  };
}

function hunters(truth: WorldTruth): readonly Platoon[] {
  return Object.values(truth.platoons)
    .filter((platoon) => platoon.side === 'enemy' && platoon.objective.kind === 'SearchArea')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** At the start: the survivor's supplies, and the hunters' sighting of the parachute. */
export function startRescue(truth: WorldTruth, knowledge: Record<string, UnitKnowledge>, scenario: Scenario): void {
  const mission = scenario.file.mission;
  if (mission.kind !== 'Rescue') return;
  const survivor = survivorOf(truth, mission);
  if (survivor === undefined) return;
  survivor.survival = { waterSeconds: mission.waterSeconds, thirstSeconds: mission.thirstSeconds, battery: mission.batteryCalls, state: 'evading', aircraftId: null };
  for (const hunter of hunters(truth)) {
    const belief = (knowledge[hunter.id] ??= emptyKnowledge());
    belief.reports['SIGHTING'] = fix('SIGHTING', mission.sightedAt, mission.sightingErrorMeters, 0);
  }
}

/**
 * Every call on the survival radio costs battery, and gives the hunters a rough fix on where it
 * came from. With the battery flat the radio says nothing. A SITREP carries the water left.
 */
export function onSurvivorTransmission(
  truth: WorldTruth,
  knowledge: Record<string, UnitKnowledge>,
  scenario: Scenario,
  rng: RngState,
  tick: number,
  unitId: string,
  message: RadioMessage,
): RadioMessage | null {
  const survival = truth.platoons[unitId]?.survival;
  if (survival === undefined) return message;
  if (survival.battery <= 0 || survival.state !== 'evading') return null;
  survival.battery -= 1;
  const squad = truth.platoons[unitId]?.squads.find((unit) => unit.personnel > 0);
  if (squad !== undefined) {
    const error = scenario.file.air.directionFindingErrorMeters;
    const label = `df/${unitId}`;
    const center = { x: squad.position.x + nextGaussian(rng, label) * error, y: squad.position.y + nextGaussian(rng, label) * error };
    for (const hunter of hunters(truth)) (knowledge[hunter.id] ??= emptyKnowledge()).reports[`DF/${unitId}`] = fix(`DF/${unitId}`, center, error, tick);
  }
  if (message.kind !== 'SITREP') return message;
  return { ...message, waterMinutes: Math.floor(Math.max(0, survival.waterSeconds) / 60), battery: survival.battery };
}

/** Water runs out, then the survivor weakens, slower and easier to catch, and then it dies. */
function thirst(platoon: Platoon): void {
  const survival = platoon.survival;
  if (survival === undefined || survival.state !== 'evading') return;
  if (survival.waterSeconds > 0) {
    survival.waterSeconds -= 1;
    if (survival.waterSeconds === 0) {
      for (const squad of platoon.squads) squad.doctrine = { ...squad.doctrine, speedMps: squad.doctrine.speedMps / 2 };
    }
    return;
  }
  survival.thirstSeconds -= 1;
  if (survival.thirstSeconds > 0) return;
  survival.state = 'dead';
  for (const squad of platoon.squads) squad.personnel = 0;
}

/**
 * Hunters who have spotted the survivor and reach it take it; a friendly search party that
 * reaches it brings it out. Walking past a man hidden in the jungle without seeing him isn't
 * finding him.
 */
function contact(truth: WorldTruth, knowledge: Record<string, UnitKnowledge>, platoon: Platoon, captureMeters: number, tick: number): void {
  const survival = platoon.survival;
  const squad = platoon.squads.find((unit) => unit.personnel > 0);
  if (survival === undefined || survival.state !== 'evading' || squad === undefined) return;
  const spotted = (searcher: string): boolean =>
    Object.values(knowledge[searcher]?.contacts ?? {}).some(
      (seen) => tick - seen.position.observedAt <= SPOTTED_SECONDS && distance(seen.position.center, squad.position) <= captureMeters * 3,
    );
  const near = (side: 'enemy' | 'friendly'): boolean =>
    truth.units.some(
      (unit) =>
        unit.side === side &&
        unit.personnel > 0 &&
        unit.platoonId !== platoon.id &&
        truth.platoons[unit.platoonId]?.objective.kind === 'SearchArea' &&
        distance(unit.position, squad.position) <= captureMeters &&
        spotted(unit.platoonId),
    );
  if (near('enemy')) {
    survival.state = 'captured';
    truth.units = truth.units.filter((unit) => unit.platoonId !== platoon.id);
  } else if (near('friendly')) {
    survival.state = 'delivered';
    truth.units = truth.units.filter((unit) => unit.platoonId !== platoon.id);
  }
}

function crewCall(player: PlayerKnowledge, radio: RadioState, aircraft: Aircraft, call: CrewCallKind, tick: number): void {
  radio.nextMessageNumber += 1;
  player.log.push({
    id: `M-${radio.nextMessageNumber}` as MessageId,
    kind: 'CREW_CALL',
    senderId: aircraft.id,
    observedAt: tick,
    sentAt: tick,
    receivedAt: tick,
    call,
    minutesLeft: 0,
    gunBursts: aircraft.gunBursts,
  });
}

/** Leaves the ground, keeping whoever boarded, and lets the survivor go back to hiding. */
export function liftOff(truth: WorldTruth, aircraft: Aircraft): void {
  aircraft.landed = false;
  aircraft.boardingSeconds = 0;
  for (const platoon of Object.values(truth.platoons)) {
    const objective = platoon.objective;
    if (objective.kind === 'Evade' && objective.boardAt !== null && platoon.survival?.state === 'evading') platoon.objective = { ...objective, boardAt: null };
  }
}

/**
 * A helicopter told to pick up edges onto the point and lands. A survivor within reach runs
 * for it, and once beside it boards over `boardSeconds`. Aboard, the crew lifts off and heads
 * home. Under fire before then, the crew lifts off by its risk limit: cautious at any fire,
 * normal when hit or under air defense fire, press on never. The controller can lift off any
 * time by giving it another task.
 */
export function resolvePickups(truth: WorldTruth, player: PlayerKnowledge, radio: RadioState, scenario: Scenario, tick: number): void {
  const { air } = scenario.file;
  for (const aircraft of truth.aircraft) {
    const order = aircraft.order;
    if (order?.kind !== 'Pickup') {
      if (aircraft.landed) liftOff(truth, aircraft);
      continue;
    }
    if (aircraft.status !== 'onStation') continue;
    if (!aircraft.landed) {
      const gap = distance(aircraft.position, order.center);
      if (gap > 1) {
        const step = Math.min(gap, air.landingSpeedMps) / gap;
        aircraft.position = { x: aircraft.position.x + (order.center.x - aircraft.position.x) * step, y: aircraft.position.y + (order.center.y - aircraft.position.y) * step };
        continue;
      }
      aircraft.landed = true;
      aircraft.boardingSeconds = 0;
      crewCall(player, radio, aircraft, 'WHEELS_DOWN', tick);
    }
    const shotAt = aircraft.firedOn.filter((entry) => tick - entry.tick <= FIRE_RECENT_SECONDS);
    const leave = aircraft.risk === 'cautious' ? shotAt.length > 0 : aircraft.risk === 'normal' ? shotAt.some((entry) => entry.hit || entry.weapon === 'AAA' || entry.weapon === 'MANPADS') : false;
    if (leave) {
      aircraft.order = { kind: 'Watch', center: order.center, radius: 300 };
      liftOff(truth, aircraft);
      crewCall(player, radio, aircraft, 'LIFTING_OFF', tick);
      continue;
    }
    for (const platoon of Object.values(truth.platoons).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const survival = platoon.survival;
      const objective = platoon.objective;
      const squad = platoon.squads.find((unit) => unit.personnel > 0);
      if (survival?.state !== 'evading' || objective.kind !== 'Evade' || squad === undefined) continue;
      const gap = distance(squad.position, aircraft.position);
      if (gap > air.boardCallMeters) continue;
      if (objective.boardAt === null) platoon.objective = { ...objective, boardAt: aircraft.position };
      if (gap > air.boardMeters) continue;
      aircraft.boardingSeconds += 1;
      if (aircraft.boardingSeconds < air.boardSeconds) continue;
      survival.state = 'aboard';
      survival.aircraftId = aircraft.id;
      aircraft.passengers.push(platoon.id);
      truth.units = truth.units.filter((unit) => unit.platoonId !== platoon.id);
      crewCall(player, radio, aircraft, 'SURVIVOR_ABOARD', tick);
      aircraft.order = { kind: 'ReturnToBase' };
      aircraft.status = 'returning';
      liftOff(truth, aircraft);
    }
  }
}

/** Each second: thirst, contact with hunters or searchers, and delivery home. */
export function updateRescue(truth: WorldTruth, knowledge: Record<string, UnitKnowledge>, scenario: Scenario, tick: number): void {
  const mission = scenario.file.mission;
  if (mission.kind !== 'Rescue') return;
  const survivor = survivorOf(truth, mission);
  if (survivor === undefined) return;
  thirst(survivor);
  contact(truth, knowledge, survivor, scenario.file.air.captureMeters, tick);
  const survival = survivor.survival;
  if (survival?.state === 'aboard') {
    const carrier = truth.aircraft.find((aircraft) => aircraft.id === survival.aircraftId);
    if (carrier !== undefined && (carrier.status === 'turnaround' || carrier.status === 'ready')) survival.state = 'delivered';
  }
}
