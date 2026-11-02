// Applies `--set path=value` overrides to a loaded scenario, for trying values without editing files.
import type { Scenario } from '../scenario/load';
import { scenarioFileSchema } from '../scenario/schema';

type Json = Record<string, unknown>;

function setPath(target: Json, path: readonly string[], value: unknown, whole: string): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  // `*` sets the value in every entry, such as every doctrine.
  const keys = head === '*' ? Object.keys(target) : [head];
  for (const key of keys) {
    if (!(key in target)) throw new Error(`--set ${whole}: no "${key}" here`);
    if (rest.length === 0) target[key] = value;
    else setPath(target[key] as Json, rest, value, whole);
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Each setting is `path=value`, with the value read as JSON when it can be. */
export function applySettings(scenario: Scenario, settings: readonly string[]): Scenario {
  if (settings.length === 0) return scenario;
  const file = structuredClone(scenario.file) as unknown as Json;
  for (const setting of settings) {
    const split = setting.indexOf('=');
    if (split < 0) throw new Error(`--set ${setting}: expected path=value`);
    setPath(file, setting.slice(0, split).split('.'), parse(setting.slice(split + 1)), setting);
  }
  const checked = scenarioFileSchema.parse(file);
  return { ...scenario, file: checked, doctrines: checked.doctrines as Scenario['doctrines'] };
}

/** Every `--set` given on the command line. */
export function settingsFromArgs(args: readonly string[]): readonly string[] {
  return args.flatMap((arg, index) => (arg === '--set' && args[index + 1] !== undefined ? [args[index + 1] as string] : []));
}
