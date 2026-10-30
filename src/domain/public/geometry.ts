import { hypot } from './det-math';

export type Vec2 = Readonly<{ x: number; y: number }>;

export function distance(a: Vec2, b: Vec2): number {
  return hypot(a.x - b.x, a.y - b.y);
}

/** Moves from `from` toward `to` by at most `step` meters. */
export function moveToward(from: Vec2, to: Vec2, step: number): Vec2 {
  const gap = distance(from, to);
  if (gap <= step) return to;
  const fraction = step / gap;
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}
