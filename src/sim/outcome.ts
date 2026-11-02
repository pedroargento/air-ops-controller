import { totalAmmunition } from '../domain/public/equipment';
import { distance } from '../domain/public/geometry';
import type { Area } from '../domain/public/ground';
import type { GroundUnit, Outcome, WorldTruth } from '../domain/truth/world';
import type { MissionConfig } from '../scenario/schema';
import type { PlayerKnowledge } from '../knowledge/player-knowledge';
import { platoonOf } from './platoon';

type HoldMission = Extract<MissionConfig, { kind: 'HoldArea' }>;
type ReachMission = Extract<MissionConfig, { kind: 'ReachArea' }>;
type LocateMission = Extract<MissionConfig, { kind: 'LocateForce' }>;

/** Personnel who can still fight: unbroken, not retreating, with ammunition left. */
export function effectiveStrength(truth: WorldTruth, unit: GroundUnit): number {
  if (unit.personnel <= 0 || totalAmmunition(unit.equipment) <= 0) return 0;
  return platoonOf(truth, unit).mode === 'steady' ? unit.personnel : 0;
}

export function strengthInArea(truth: WorldTruth, side: GroundUnit['side'], { area }: Readonly<{ area: Area }>): number {
  return truth.units
    .filter((u) => u.side === side && distance(u.position, area.center) <= area.radius)
    .reduce((sum, u) => sum + effectiveStrength(truth, u), 0);
}

function finish(truth: WorldTruth, outcome: Outcome, tick: number): void {
  truth.outcome = outcome;
  truth.endedAtTick = tick;
}

function updateHoldArea(truth: WorldTruth, mission: HoldMission, durationSeconds: number, tick: number): void {
  const enemy = strengthInArea(truth, 'enemy', mission);
  const defenders = strengthInArea(truth, 'friendly', mission);
  const contested = enemy >= mission.enemyMinEffective && defenders < mission.defenderMinEffective;
  truth.captureProgressSeconds = contested ? truth.captureProgressSeconds + 1 : 0;

  if (truth.captureProgressSeconds >= mission.holdSeconds) finish(truth, 'failure', tick);
  else if (tick >= durationSeconds) finish(truth, defenders >= mission.successMinDefenders ? 'success' : 'partial', tick);
}

/** Ends once every surviving unit has arrived, or at the deadline with whoever made it. */
function updateReachArea(truth: WorldTruth, mission: ReachMission, durationSeconds: number, tick: number): void {
  const { center, radius } = mission.area;
  const units = truth.units.filter((u) => mission.unitIds.includes(u.platoonId) && u.personnel > 0);
  const arrived = units.filter((u) => distance(u.position, center) <= radius);
  if (arrived.length < units.length && tick < durationSeconds) return;
  const personnel = arrived.reduce((sum, u) => sum + u.personnel, 0);
  if (personnel >= mission.successMinPersonnel) finish(truth, 'success', tick);
  else finish(truth, personnel >= mission.partialMinPersonnel ? 'partial' : 'failure', tick);
}

/** Share of the enemy's living squads that the player's picture has about right, right now. */
export function locatedShare(truth: WorldTruth, player: PlayerKnowledge, mission: LocateMission, tick: number): number {
  const enemy = truth.units.filter((unit) => unit.side === 'enemy' && unit.personnel > 0);
  if (enemy.length === 0) return 1;
  const picture = Object.values(player.contacts).filter(
    ({ contact, status }) =>
      contact.identification === 'hostile' &&
      (status === 'active' || status === 'hit') &&
      tick - contact.position.observedAt <= mission.freshSeconds,
  );
  const located = enemy.filter((unit) =>
    picture.some(({ contact }) => distance(contact.position.center, unit.position) <= mission.locateMeters),
  );
  return located.length / enemy.length;
}

function updateLocate(truth: WorldTruth, player: PlayerKnowledge, mission: LocateMission, durationSeconds: number, tick: number): void {
  if (tick < durationSeconds) return;
  const share = locatedShare(truth, player, mission, tick);
  truth.locatedShare = share;
  finish(truth, share >= mission.successShare ? 'success' : share >= mission.partialShare ? 'partial' : 'failure', tick);
}

export function updateOutcome(
  truth: WorldTruth,
  mission: MissionConfig,
  durationSeconds: number,
  tick: number,
  player: PlayerKnowledge,
): void {
  if (mission.kind === 'HoldArea') updateHoldArea(truth, mission, durationSeconds, tick);
  else if (mission.kind === 'ReachArea') updateReachArea(truth, mission, durationSeconds, tick);
  else updateLocate(truth, player, mission, durationSeconds, tick);
}
