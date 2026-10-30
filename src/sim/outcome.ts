import { distance } from '../domain/public/geometry';
import type { GroundUnit, WorldTruth } from '../domain/truth/world';
import type { CaptureConfig } from '../scenario/schema';

/** Personnel who can still fight: unbroken, not retreating, with ammunition left. */
export function effectiveStrength(unit: GroundUnit): number {
  if (unit.personnel <= 0 || unit.ammunition <= 0) return 0;
  return unit.mode === 'steady' ? unit.personnel : 0;
}

export function strengthInArea(truth: WorldTruth, side: GroundUnit['side'], capture: CaptureConfig): number {
  return truth.units
    .filter((u) => u.side === side && distance(u.position, capture.area.center) <= capture.area.radius)
    .reduce((sum, u) => sum + effectiveStrength(u), 0);
}

export function updateOutcome(
  truth: WorldTruth,
  capture: CaptureConfig,
  durationSeconds: number,
  tick: number,
): void {
  const enemy = strengthInArea(truth, 'enemy', capture);
  const defenders = strengthInArea(truth, 'friendly', capture);
  const contested = enemy >= capture.enemyMinEffective && defenders < capture.defenderMinEffective;
  truth.captureProgressSeconds = contested ? truth.captureProgressSeconds + 1 : 0;

  if (truth.captureProgressSeconds >= capture.holdSeconds) {
    truth.outcome = 'captured';
    truth.endedAtTick = tick;
  } else if (tick >= durationSeconds) {
    truth.outcome = defenders >= capture.successMinDefenders ? 'held' : 'heldBelowStrength';
    truth.endedAtTick = tick;
  }
}
