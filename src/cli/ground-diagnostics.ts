import type { SimState } from '../sim/state';

const counters = () => ({
  activeSquadSeconds: 0, firingSquadSeconds: 0, supportWaitSquadSeconds: 0,
  exposedSupportWaitSquadSeconds: 0, supportWaitPersonnelLost: 0, supportTimeouts: 0,
  phaseSquadSeconds: {} as Record<string, number>, waitSquadSeconds: {} as Record<string, number>,
});

/** Observer only: never read by the simulation or its decision makers. One observation per tick. */
export class GroundDiagnostics {
  readonly sides = { friendly: counters(), enemy: counters() };
  private readonly personnel = new Map<string, number>();
  private readonly timeouts = new Set<string>();

  observe(state: SimState): void {
    const tick = state.tick - 1; // step has already advanced the clock.
    for (const platoon of Object.values(state.truth.platoons)) {
      const totals = this.sides[platoon.side];
      for (const entry of platoon.handled) {
        if (entry.reason !== 'support-timeout') continue;
        const key = `${platoon.id}/${entry.tick}`;
        if (!this.timeouts.has(key)) { totals.supportTimeouts++; this.timeouts.add(key); }
      }
      for (const unit of platoon.squads) {
        const before = this.personnel.get(unit.id) ?? unit.initialPersonnel;
        this.personnel.set(unit.id, unit.personnel);
        if (tick < platoon.activeFromTick || before <= 0) continue;
        totals.activeSquadSeconds++;
        if (unit.groundVolley?.at === tick) totals.firingSquadSeconds++;
        const phase = platoon.drillPhase ?? platoon.mode;
        totals.phaseSquadSeconds[phase] = (totals.phaseSquadSeconds[phase] ?? 0) + 1;
        const reason = platoon.drillWaitReason;
        if (reason !== null) totals.waitSquadSeconds[reason] = (totals.waitSquadSeconds[reason] ?? 0) + 1;
        const stationary = unit.intent.kind === 'hold' || unit.intent.kind === 'wait' ||
          (unit.intent.kind === 'engage' && unit.intent.closeTo === null);
        if (reason !== 'support' || unit.role !== 'maneuver' || !stationary) continue;
        totals.supportWaitSquadSeconds++;
        if (unit.lastHitAtTick !== null && tick - unit.lastHitAtTick <= 15) totals.exposedSupportWaitSquadSeconds++;
        totals.supportWaitPersonnelLost += Math.max(0, before - unit.personnel);
      }
    }
  }
}
