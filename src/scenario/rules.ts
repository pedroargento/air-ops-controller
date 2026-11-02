export const DEFAULT_SCENARIO_NAME = 'outpost-under-pressure';

/** A scenario file as read, before its rules are merged in. */
export type RawScenario = Readonly<Record<string, unknown>> & {
  rules: string;
  terrain: Readonly<{ classLayer: string; elevationLayer: string }>;
};

type Layer = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Layer =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Lays a scenario over shared rules, so tuning lives in one place. Top-level sections
 * merge one level deep: a scenario can replace one doctrine or one weather value.
 */
export function applyRules(scenario: Layer, rules: Layer): Layer {
  const merged: Record<string, unknown> = { ...rules, ...scenario };
  for (const [key, shared] of Object.entries(rules)) {
    const own = scenario[key];
    if (isObject(shared) && isObject(own)) merged[key] = { ...shared, ...own };
  }
  return merged;
}
