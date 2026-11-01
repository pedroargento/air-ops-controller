import { loadScenario, type Scenario } from './load';
import { applyRules } from './rules';

type RawScenario = Readonly<Record<string, unknown>> & {
  rules: string;
  terrain: Readonly<{ classLayer: string; elevationLayer: string }>;
};

// The browser's copy of the scenario folder, bundled at build time.
const scenarioFiles = import.meta.glob<RawScenario>('../../scenarios/*.json', { eager: true, import: 'default' });
const ruleFiles = import.meta.glob<Record<string, unknown>>('../../scenarios/rules/*.json', { eager: true, import: 'default' });
const layers = import.meta.glob<string>('../../scenarios/*/*.txt', { eager: true, query: '?raw', import: 'default' });

export const DEFAULT_SCENARIO_NAME = 'outpost-under-pressure';

export function scenarioNames(): readonly string[] {
  return Object.keys(scenarioFiles)
    .map((path) => path.replace(/^.*\//, '').replace(/\.json$/, ''))
    .sort();
}

function required<T>(found: T | undefined, what: string): T {
  if (found === undefined) throw new Error(`Missing ${what}`);
  return found;
}

export function loadBundledScenario(name: string): Scenario {
  const raw = scenarioFiles[`../../scenarios/${name}.json`];
  if (raw === undefined) throw new Error(`Unknown scenario "${name}". Available: ${scenarioNames().join(', ')}`);
  const rules = required(ruleFiles[`../../scenarios/rules/${raw.rules}.json`], `rules ${raw.rules}`);
  const layer = (path: string): string => required(layers[`../../scenarios/${path}`], `terrain layer ${path}`);
  return loadScenario(applyRules(raw, rules), layer(raw.terrain.classLayer), layer(raw.terrain.elevationLayer));
}
