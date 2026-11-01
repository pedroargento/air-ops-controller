import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { applyRules } from '../scenario/rules';
import { loadScenario, type Scenario } from '../scenario/load';

const SCENARIO_DIRECTORY = 'scenarios';
export const DEFAULT_SCENARIO_NAME = 'outpost-under-pressure';

type RawScenario = Readonly<Record<string, unknown>> & {
  rules: string;
  terrain: Readonly<{ classLayer: string; elevationLayer: string }>;
};

export function scenarioNames(): readonly string[] {
  return readdirSync(SCENARIO_DIRECTORY)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => basename(entry, '.json'))
    .sort();
}

function scenarioPath(name: string): string {
  const path = join(SCENARIO_DIRECTORY, `${name}.json`);
  if (!existsSync(path)) throw new Error(`Unknown scenario "${name}". Available: ${scenarioNames().join(', ')}`);
  return path;
}

/** The scenario with its shared rules applied, before validation. */
export function readScenarioFile(name: string): RawScenario {
  const path = scenarioPath(name);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RawScenario;
  const rules = JSON.parse(readFileSync(join(dirname(path), 'rules', `${raw.rules}.json`), 'utf8')) as Record<string, unknown>;
  return applyRules(raw, rules) as RawScenario;
}

export function readTerrainLayer(layer: string): string {
  return readFileSync(join(SCENARIO_DIRECTORY, layer), 'utf8');
}

export function loadScenarioFile(name: string = DEFAULT_SCENARIO_NAME): Scenario {
  const raw = readScenarioFile(name);
  return loadScenario(raw, readTerrainLayer(raw.terrain.classLayer), readTerrainLayer(raw.terrain.elevationLayer));
}
