import type { CasualtyLedger, GroundUnit, WorldTruth, WoundedGroup } from '../domain/truth/world';
import { nextBinomial, type RngState } from '../rng/streams';
import type { CombatConfig } from '../scenario/schema';

/*
 * Wounded (§4.1.1): casualties are numbers, split into killed and wounded. Wounded stay with
 * their squad, tie down men to carry them, and die as they wait, until a helicopter takes them
 * out (§8.9). The same rules hold for both sides.
 */

const UPDATE_SECONDS = 5;

export function emptyLedger(): CasualtyLedger {
  return { killed: 0, wounded: 0, diedOfWounds: 0, evacuated: 0, hospitalSeconds: 0 };
}

export function woundedCount(groups: readonly WoundedGroup[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0);
}

/** Fit men tied down carrying the squad's wounded. */
export function carers(unit: GroundUnit, config: CombatConfig): number {
  return Math.min(unit.personnel, Math.ceil(woundedCount(unit.wounded) * config.carersPerWounded));
}

/** Fit men free to fight: the ones not carrying wounded. */
export function fightingMen(unit: GroundUnit, config: CombatConfig): number {
  return unit.personnel - carers(unit, config);
}

/** Carrying wounded slows a squad: by `woundedSlow` when it has as many wounded as fit men. */
export function woundedSpeedFactor(unit: GroundUnit, config: CombatConfig): number {
  const wounded = woundedCount(unit.wounded);
  if (wounded === 0 || unit.personnel <= 0) return 1;
  return 1 - config.woundedSlow * Math.min(1, wounded / unit.personnel);
}

/** Splits a squad's casualties into killed and wounded, on its own random stream. */
export function takeCasualties(truth: WorldTruth, unit: GroundUnit, casualties: number, config: CombatConfig, rng: RngState, tick: number): void {
  const wounded = nextBinomial(rng, `wounds/${unit.id}`, casualties, config.woundedShare);
  const ledger = truth.casualties[unit.side];
  ledger.killed += casualties - wounded;
  ledger.wounded += wounded;
  if (wounded > 0) unit.wounded.push({ count: wounded, since: tick });
}

/** The longest a group of the squad's wounded has waited, or null with none. */
export function longestWait(groups: readonly WoundedGroup[], tick: number): number | null {
  const oldest = groups.reduce<number | null>((first, group) => (first === null || group.since < first ? group.since : first), null);
  return oldest === null ? null : tick - oldest;
}

/**
 * One update of the wounded's clock. Each group dies at a rate that rises the longer it has
 * waited. A squad with no fit men left loses its wounded with it, counted as killed.
 */
export function updateWounds(truth: WorldTruth, config: CombatConfig, rng: RngState, tick: number): void {
  for (const unit of truth.units) {
    if (unit.wounded.length === 0) continue;
    const ledger = truth.casualties[unit.side];
    if (unit.personnel <= 0) {
      const lost = woundedCount(unit.wounded);
      ledger.killed += lost;
      ledger.wounded -= lost;
      unit.wounded = [];
      continue;
    }
    for (const group of unit.wounded) {
      const waited = tick - group.since;
      const chance = Math.min(1, ((config.woundDeathPerHour * UPDATE_SECONDS) / 3600) * (1 + waited / config.woundWorsenSeconds));
      const died = nextBinomial(rng, `dow/${unit.id}`, group.count, chance);
      group.count -= died;
      ledger.diedOfWounds += died;
    }
    unit.wounded = unit.wounded.filter((group) => group.count > 0);
  }
}

/** Takes up to `count` wounded from a squad, longest-waiting first. */
export function takeWounded(unit: GroundUnit, count: number): WoundedGroup[] {
  const taken: WoundedGroup[] = [];
  let left = count;
  const groups = [...unit.wounded].sort((a, b) => a.since - b.since);
  for (const group of groups) {
    if (left <= 0) break;
    const moved = Math.min(left, group.count);
    group.count -= moved;
    left -= moved;
    taken.push({ count: moved, since: group.since });
  }
  unit.wounded = unit.wounded.filter((group) => group.count > 0);
  return taken;
}
