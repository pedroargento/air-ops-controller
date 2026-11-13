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

/**
 * Every model airborne in a minute, as before takeoff was set per model. For tests timed in
 * ticks that are about something else.
 */
export function quickTakeoff(scenario: Scenario): Scenario {
  const models = Object.fromEntries(Object.entries(scenario.file.air.models).map(([name, model]) => [name, { ...model, takeoffSeconds: 60 }]));
  return { ...scenario, file: { ...scenario.file, air: { ...scenario.file.air, models } } };
}

/** The base 25 km out, where the outposts' was before R4 moved it to 40 km. For tests timed in ticks. */
export function nearBase(scenario: Scenario): Scenario {
  const { airbase } = scenario.file.air;
  return { ...scenario, file: { ...scenario.file, air: { ...scenario.file.air, airbase: { x: airbase.x, y: Math.sign(airbase.y) * 25_000 } } } };
}

/** A platoon's first squad, which in `singleSquads` is the whole platoon. */
export function squadOf(truth: WorldTruth, platoonId: string): GroundUnit {
  const unit = truth.units.find((u) => u.platoonId === (platoonId as UnitId));
  if (unit === undefined) throw new Error(`No squad in ${platoonId}`);
  return unit;
}
