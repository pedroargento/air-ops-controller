// Canonical JSON: sorted keys, Maps as sorted entries, undefined omitted.
// Non-finite numbers are rejected because they indicate a simulation bug and
// would otherwise serialize to null and hide it.
function canonicalize(value: unknown): unknown {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number in state: ${value}`);
    return value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const entries =
    value instanceof Map
      ? [...value.entries()].map(([k, v]): [string, unknown] => [String(k), v])
      : Object.entries(value);
  const sorted: Record<string, unknown> = {};
  for (const [key, entry] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (entry !== undefined) sorted[key] = canonicalize(entry);
  }
  return sorted;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashState(value: unknown): string {
  const text = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
