export const GAME_SPEEDS = [1, 2, 4, 8] as const;

export function parseSpeed(raw: string | null): number {
  const speed = Number(raw);
  return GAME_SPEEDS.some((allowed) => allowed === speed) ? speed : 1;
}

export function parseSeed(raw: string | null, fallback: () => number): number {
  const seed = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isSafeInteger(seed) ? seed : fallback();
}
