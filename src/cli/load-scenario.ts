import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ScenarioFile } from '../scenario/schema';
import { loadScenario, type Scenario } from '../scenario/load';

export const DEFAULT_SCENARIO = 'scenarios/outpost-under-pressure.json';

export function loadScenarioFile(path: string = DEFAULT_SCENARIO): Scenario {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as ScenarioFile;
  const directory = dirname(path);
  return loadScenario(
    raw,
    readFileSync(join(directory, raw.terrain.classLayer), 'utf8'),
    readFileSync(join(directory, raw.terrain.elevationLayer), 'utf8'),
  );
}
