import type { Vec2 } from '../domain/public/geometry';

/* Fire marks (§7.3), drawn by the same code on the map and in the key. */

export const HOSTILE_FIRE = '#d0201a';
export const FRIENDLY_FIRE = '#1f5fbf';

export type FireStyle = Readonly<{ color: string; seen: boolean; heavy: boolean; opacity: number }>;

/** A fire line in screen pixels, with an arrowhead where the fire lands. Solid if seen, dashed if reported. */
export function drawFireArrow(ctx: CanvasRenderingContext2D, from: Vec2, to: Vec2, style: FireStyle): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return;
  const ux = dx / length;
  const uy = dy / length;
  ctx.save();
  ctx.globalAlpha = style.opacity * 0.9;
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineWidth = style.heavy ? 3 : 2;
  ctx.setLineDash(style.seen ? [] : [7, 5]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  const head = style.heavy ? 9 : 7;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - ux * head - uy * head * 0.55, to.y - uy * head + ux * head * 0.55);
  ctx.lineTo(to.x - ux * head + uy * head * 0.55, to.y - uy * head - ux * head * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Fire from a direction only: a pale wedge, its point at the unit, opening toward the unseen shooter. */
export function drawFireWedge(ctx: CanvasRenderingContext2D, corners: readonly [Vec2, Vec2, Vec2], style: FireStyle): void {
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineWidth = style.heavy ? 3 : 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  corners.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
  ctx.closePath();
  ctx.globalAlpha = style.opacity * 0.18;
  ctx.fill();
  ctx.globalAlpha = style.opacity * 0.9;
  ctx.stroke();
  ctx.restore();
}
