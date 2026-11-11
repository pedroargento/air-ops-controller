import type { UnitId } from '../../src/domain/public/ground';
import type { GroundUnit, WorldTruth } from '../../src/domain/truth/world';
import type { Scenario } from '../../src/scenario/load';

/** One squad per platoon, for tests of a rule rather than of how a platoon divides. */
export function singleSquads(scenario: Scenario): Scenario {
  const file = { ...scenario.file, combat: { ...scenario.file.combat, squadSize: 1_000_000 } };
  return { ...scenario, file };
}

/**
 * Crews free to bomb targets they pick themselves, as before R3.1 made guns the default. For
 * tests of what a crew's own bombing does, not of who decides it.
 */
export function weaponsFree(scenario: Scenario): Scenario {
  return { ...scenario, file: { ...scenario.file, air: { ...scenario.file.air, defaultWeapons: 'both' } } };
}

/** A platoon's first squad, which in `singleSquads` is the whole platoon. */
export function squadOf(truth: WorldTruth, platoonId: string): GroundUnit {
  const unit = truth.units.find((u) => u.platoonId === (platoonId as UnitId));
  if (unit === undefined) throw new Error(`No squad in ${platoonId}`);
  return unit;
}
