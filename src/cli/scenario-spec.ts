// A scenario as the command line describes it. A worker rebuilds the same scenario from this,
// because a loaded scenario holds terrain and can't be sent between threads cheaply.
import type { DrillKind } from '../domain/public/ground';
import type { Scenario } from '../scenario/load';
import { loadScenarioFile } from './load-scenario';
import { applySettings } from './settings';

export type ScenarioSpec = Readonly<{
  name: string;
  /** Drills every doctrine forgets, to measure what each is worth. */
  withoutDrills: readonly string[];
  /** `path=value` overrides, as given to `--set`. */
  settings: readonly string[];
}>;

/** The same scenario with some drills forgotten, to measure what each is worth. */
function withoutDrills(scenario: Scenario, drills: readonly string[]): Scenario {
  const forget = <T extends Readonly<{ drills: readonly DrillKind[]; experimentalDrills?: readonly DrillKind[] }>>(doctrines: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(
      Object.entries(doctrines).map(([name, doctrine]) => [
        name,
        { ...doctrine, drills: doctrine.drills.filter((drill) => !drills.includes(drill)),
          ...(doctrine.experimentalDrills === undefined ? {} : { experimentalDrills: doctrine.experimentalDrills.filter((drill) => !drills.includes(drill)) }) },
      ]),
    );
  return { ...scenario, doctrines: forget(scenario.doctrines), file: { ...scenario.file, doctrines: forget(scenario.file.doctrines) } };
}

export function buildScenario(spec: ScenarioSpec): Scenario {
  return applySettings(withoutDrills(loadScenarioFile(spec.name), spec.withoutDrills), spec.settings);
}
