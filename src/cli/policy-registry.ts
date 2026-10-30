import { immediateCas, noAir, reactiveCas, reconInformed, type Policy } from '../policies/air-policies';
import type { Scenario } from '../scenario/load';

// Shared by the batch runner and the debug page, so it must stay free of Node imports.
export function policies(scenario: Scenario): Readonly<Record<string, () => Policy>> {
  const objective = scenario.file.capture.area.center;
  return {
    none: () => noAir,
    reactive: reactiveCas,
    immediate: immediateCas,
    informed: () => reconInformed(objective, true),
    informedNoForward: () => reconInformed(objective, false),
  };
}
