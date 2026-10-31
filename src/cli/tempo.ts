import { totalAmmunition } from '../domain/public/equipment';
import { distance, type Vec2 } from '../domain/public/geometry';
import type { GroundBehavior, GroundMode } from '../domain/public/ground';
import type { GroundUnit } from '../domain/truth/world';
import type { Scenario } from '../scenario/load';
import type { SimState } from '../sim/state';

const BOUT_GAP_SECONDS = 120;
const WARNING_RANGE_METERS = 1500;
const SUPPRESSED = 0.5;
const RECOVERED = 0.2;

export type WithdrawalTrigger = 'casualties' | 'morale' | 'suppression' | 'ammunition' | 'other';

// Measured from truth, so these are for balancing only and never reach the player.
export type Tempo = Readonly<{
  fireMinuteShare: number;
  bouts: number;
  meanBoutSeconds: number;
  friendlyCasualtiesPerMinute: number;
  enemyCasualtiesPerMinute: number;
  meanSuppressionRecoverySeconds: number | null;
  lowestGarrisonMorale: number;
  firstGarrisonFireTick: number | null;
  firstDecisiveAssaultTick: number | null;
  warningSeconds: number | null;
  withdrawals: Readonly<Record<WithdrawalTrigger, number>>;
  returns: number;
  behaviorChanges: number;
  behaviorSeconds: Readonly<Record<GroundBehavior, number>>;
}>;

function withdrawalTrigger(unit: GroundUnit): WithdrawalTrigger {
  const { doctrine } = unit;
  if (totalAmmunition(unit.equipment) <= 0) return 'ammunition';
  if (unit.suppression >= doctrine.withdrawSuppression) return 'suppression';
  if (unit.morale <= doctrine.withdrawMorale) return 'morale';
  if (1 - unit.personnel / unit.initialPersonnel >= doctrine.withdrawCasualties) return 'casualties';
  return 'other';
}

/** Follows one battle tick by tick. */
export class TempoTracker {
  private readonly modes = new Map<string, GroundMode>();
  private readonly behaviors = new Map<string, GroundBehavior | null>();
  private readonly suppressedSince = new Map<string, number>();
  private readonly personnel: Readonly<Record<'friendly' | 'enemy', number>>;
  private readonly objective: Vec2;
  private readonly garrison: ReadonlySet<string>;
  private readonly fireMinutes = new Set<number>();
  private readonly recoveries: number[] = [];
  private readonly withdrawals: Record<WithdrawalTrigger, number> = {
    casualties: 0,
    morale: 0,
    suppression: 0,
    ammunition: 0,
    other: 0,
  };
  private readonly behaviorSeconds: Record<GroundBehavior, number> = {
    observe: 0,
    probe: 0,
    harass: 0,
    assault: 0,
    disengage: 0,
  };
  private lastFire: number | null = null;
  private boutStart = 0;
  private boutSeconds = 0;
  private bouts = 0;
  private behaviorChanges = 0;
  private lowestGarrisonMorale = 1;
  private firstGarrisonFireTick: number | null = null;
  private firstDecisiveAssaultTick: number | null = null;
  private firstWarningTick: number | null = null;

  constructor(state: SimState, scenario: Scenario) {
    const sum = (side: GroundUnit['side']): number =>
      state.truth.units.filter((u) => u.side === side).reduce((total, u) => total + u.personnel, 0);
    this.personnel = { friendly: sum('friendly'), enemy: sum('enemy') };
    this.objective = scenario.file.capture.area.center;
    this.garrison = new Set(
      state.truth.units
        .filter((u) => u.side === 'friendly' && u.objective.kind === 'HoldArea')
        .map((u) => u.id),
    );
  }

  /** Call after each step; `state.tick` has already advanced past the events it reads. */
  observe(state: SimState): void {
    const tick = state.tick - 1;
    let firing = false;
    for (const unit of state.truth.units) {
      if (unit.lastFiredAtTick === tick) firing = true;
      this.followGarrison(unit, tick);
      this.followMode(unit);
      this.followBehavior(unit, tick);
      this.followSuppression(unit, tick);
    }
    if (firing) this.followFire(tick);
    this.firstWarningTick ??= this.warningAt(state, tick);
  }

  private followGarrison(unit: GroundUnit, tick: number): void {
    if (!this.garrison.has(unit.id)) return;
    this.lowestGarrisonMorale = Math.min(this.lowestGarrisonMorale, unit.morale);
    if (unit.lastHitAtTick === tick) this.firstGarrisonFireTick ??= tick;
  }

  private followMode(unit: GroundUnit): void {
    const previous = this.modes.get(unit.id);
    if (previous === 'steady' && unit.mode === 'withdrawing') {
      this.withdrawals[withdrawalTrigger(unit)] += 1;
    }
    this.modes.set(unit.id, unit.mode);
  }

  private followBehavior(unit: GroundUnit, tick: number): void {
    if (unit.behavior !== null) this.behaviorSeconds[unit.behavior] += 1;
    if (this.behaviors.has(unit.id) && this.behaviors.get(unit.id) !== unit.behavior) {
      this.behaviorChanges += 1;
    }
    this.behaviors.set(unit.id, unit.behavior);
    const assaulting =
      unit.behavior === 'assault' &&
      unit.side === 'enemy' &&
      unit.doctrine.closesToMeters !== null &&
      distance(unit.position, this.objective) <= unit.doctrine.detectRangeMeters;
    if (assaulting) this.firstDecisiveAssaultTick ??= tick;
  }

  private followSuppression(unit: GroundUnit, tick: number): void {
    const since = this.suppressedSince.get(unit.id);
    if (since === undefined && unit.suppression >= SUPPRESSED) {
      this.suppressedSince.set(unit.id, tick);
    } else if (since !== undefined && unit.suppression <= RECOVERED) {
      this.recoveries.push(tick - since);
      this.suppressedSince.delete(unit.id);
    }
  }

  private followFire(tick: number): void {
    this.fireMinutes.add(Math.floor(tick / 60));
    if (this.lastFire === null || tick - this.lastFire > BOUT_GAP_SECONDS) {
      this.closeBout();
      this.bouts += 1;
      this.boutStart = tick;
    }
    this.lastFire = tick;
  }

  private closeBout(): void {
    if (this.lastFire !== null) this.boutSeconds += this.lastFire - this.boutStart;
  }

  private warningAt(state: SimState, tick: number): number | null {
    const near = Object.values(state.player.contacts).some(
      ({ contact }) =>
        contact.identification === 'hostile' &&
        distance(contact.position.center, this.objective) <= WARNING_RANGE_METERS,
    );
    return near ? tick : null;
  }

  finish(state: SimState): Tempo {
    this.closeBout();
    const minutes = Math.max(1, state.tick / 60);
    const lost = (side: GroundUnit['side']): number =>
      this.personnel[side] -
      state.truth.units.filter((u) => u.side === side).reduce((total, u) => total + u.personnel, 0);
    const warned = this.firstDecisiveAssaultTick !== null && this.firstWarningTick !== null;
    return {
      fireMinuteShare: this.fireMinutes.size / minutes,
      bouts: this.bouts,
      meanBoutSeconds: this.bouts === 0 ? 0 : this.boutSeconds / this.bouts,
      friendlyCasualtiesPerMinute: lost('friendly') / minutes,
      enemyCasualtiesPerMinute: lost('enemy') / minutes,
      meanSuppressionRecoverySeconds:
        this.recoveries.length === 0
          ? null
          : this.recoveries.reduce((sum, value) => sum + value, 0) / this.recoveries.length,
      lowestGarrisonMorale: this.lowestGarrisonMorale,
      firstGarrisonFireTick: this.firstGarrisonFireTick,
      firstDecisiveAssaultTick: this.firstDecisiveAssaultTick,
      warningSeconds: warned
        ? (this.firstDecisiveAssaultTick as number) - (this.firstWarningTick as number)
        : null,
      withdrawals: this.withdrawals,
      returns: state.truth.units.reduce((sum, u) => sum + u.returnsUsed, 0),
      behaviorChanges: this.behaviorChanges,
      behaviorSeconds: this.behaviorSeconds,
    };
  }
}
