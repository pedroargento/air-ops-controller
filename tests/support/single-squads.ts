import type { UnitId } from '../../src/domain/public/ground';
import type { GroundUnit, WorldTruth } from '../../src/domain/truth/world';
import type { Scenario } from '../../src/scenario/load';

/** One squad per platoon, for tests of a rule rather than of how a platoon divides. */
export function singleSquads(scenario: Scenario): Scenario {
  const file = { ...scenario.file, combat: { ...scenario.file.combat, squadSize: 1_000_000 } };
  return { ...scenario, file };
}

/** A platoon's first squad, which in `singleSquads` is the whole platoon. */
export function squadOf(truth: WorldTruth, platoonId: string): GroundUnit {
  const unit = truth.units.find((u) => u.platoonId === (platoonId as UnitId));
  if (unit === undefined) throw new Error(`No squad in ${platoonId}`);
  return unit;
}
