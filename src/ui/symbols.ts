import type { Vec2 } from '../domain/public/geometry';
import { CONDITION_COLORS, ECHELON_MARKS, type ConditionEstimate, type Echelon } from './map-conventions';

/*
 * Unit symbols in the manner of APP-6: the frame shape says whose it is, the icon inside
 * what it is, and the marks around it how big, how hurt and which way it's going. Drawn in
 * our own simple style; only the conventions are borrowed.
 */

export type Affiliation = 'friend' | 'hostile' | 'suspect' | 'unknown';

const FILLS: Readonly<Record<Affiliation, string>> = {
  friend: '#80e0ff',
  hostile: '#ff8080',
  suspect: '#ffb0a8',
  unknown: '#ffff80',
};

export type Modifier = Readonly<{ text: string; color?: string }>;

export type UnitSymbol = Readonly<{
  affiliation: Affiliation;
  icon: 'infantry' | 'armour' | null;
  airDefense: boolean;
  echelon: Echelon | null;
  reduced: boolean;
  condition: ConditionEstimate | null;
  destroyed: 'confirmed' | 'probable' | null;
  /** Dashed frame: a suspect, or a friend that has gone quiet. */
  dashed: boolean;
  /** No fill: looked for and not found. */
  hollow: boolean;
  selected: boolean;
  /** Direction of movement, when it's seen moving. */
  headingRad: number | null;
  right: readonly Modifier[];
}>;

const INK = '#141414';
const SIZE = 9;

type Box = Readonly<{ halfWidth: number; halfHeight: number }>;

function frameBox(affiliation: Affiliation): Box {
  switch (affiliation) {
    case 'friend':
      return { halfWidth: SIZE * 1.45, halfHeight: SIZE };
    case 'hostile':
    case 'suspect':
      return { halfWidth: SIZE * 1.35, halfHeight: SIZE * 1.35 };
    case 'unknown':
      return { halfWidth: SIZE * 1.2, halfHeight: SIZE * 1.2 };
  }
}

function framePath(ctx: CanvasRenderingContext2D, at: Vec2, affiliation: Affiliation): void {
  const { halfWidth, halfHeight } = frameBox(affiliation);
  ctx.beginPath();
  switch (affiliation) {
    case 'friend':
      ctx.rect(at.x - halfWidth, at.y - halfHeight, halfWidth * 2, halfHeight * 2);
      return;
    case 'hostile':
    case 'suspect':
      ctx.moveTo(at.x, at.y - halfHeight);
      ctx.lineTo(at.x + halfWidth, at.y);
      ctx.lineTo(at.x, at.y + halfHeight);
      ctx.lineTo(at.x - halfWidth, at.y);
      ctx.closePath();
      return;
    case 'unknown': {
      // Quatrefoil: four lobes, one on each side.
      const lobe = halfWidth * 0.5;
      const reach = halfWidth - lobe;
      ctx.arc(at.x, at.y - reach, lobe, Math.PI * 0.75, Math.PI * 0.25);
      ctx.arc(at.x + reach, at.y, lobe, Math.PI * 1.25, Math.PI * 0.75);
      ctx.arc(at.x, at.y + reach, lobe, Math.PI * 1.75, Math.PI * 1.25);
      ctx.arc(at.x - reach, at.y, lobe, Math.PI * 0.25, Math.PI * 1.75);
      ctx.closePath();
      return;
    }
  }
}

/** The part of the frame an icon fits in. */
function innerBox(affiliation: Affiliation): Box {
  const { halfWidth, halfHeight } = frameBox(affiliation);
  return affiliation === 'friend' ? { halfWidth, halfHeight } : { halfWidth: halfWidth * 0.5, halfHeight: halfHeight * 0.5 };
}

function drawIcon(ctx: CanvasRenderingContext2D, at: Vec2, symbol: UnitSymbol): void {
  const { halfWidth, halfHeight } = innerBox(symbol.affiliation);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (symbol.icon === 'infantry') {
    ctx.moveTo(at.x - halfWidth, at.y - halfHeight);
    ctx.lineTo(at.x + halfWidth, at.y + halfHeight);
    ctx.moveTo(at.x + halfWidth, at.y - halfHeight);
    ctx.lineTo(at.x - halfWidth, at.y + halfHeight);
  } else if (symbol.icon === 'armour') {
    ctx.ellipse(at.x, at.y, halfWidth * 0.7, halfHeight * 0.45, 0, 0, Math.PI * 2);
  }
  ctx.stroke();
  if (symbol.airDefense) {
    // The air defense dome rises from the bottom of the frame.
    const { halfHeight: frameHalf } = frameBox(symbol.affiliation);
    const base = at.y + (symbol.affiliation === 'friend' ? frameHalf : frameHalf * 0.55);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(at.x, base, halfWidth * 0.75, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
}

/** Text with a pale halo, as map lettering is, so it reads over any ground. */
export function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color = INK,
  font = 'bold 11px sans-serif',
  align: CanvasTextAlign = 'left',
): void {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.lineJoin = 'miter';
  ctx.textAlign = 'left';
}

function drawCross(ctx: CanvasRenderingContext2D, at: Vec2, box: Box, dashed: boolean): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  if (dashed) ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(at.x - box.halfWidth - 3, at.y - box.halfHeight - 3);
  ctx.lineTo(at.x + box.halfWidth + 3, at.y + box.halfHeight + 3);
  ctx.moveTo(at.x + box.halfWidth + 3, at.y - box.halfHeight - 3);
  ctx.lineTo(at.x - box.halfWidth - 3, at.y + box.halfHeight + 3);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawMovement(ctx: CanvasRenderingContext2D, at: Vec2, box: Box, headingRad: number): void {
  // APP-6 hangs the arrow from the bottom of the frame on a short staff.
  const foot = { x: at.x, y: at.y + box.halfHeight + 5 };
  const tip = { x: foot.x + Math.cos(headingRad) * 22, y: foot.y + Math.sin(headingRad) * 22 };
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y + box.halfHeight);
  ctx.lineTo(foot.x, foot.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - Math.cos(headingRad - 0.45) * 7, tip.y - Math.sin(headingRad - 0.45) * 7);
  ctx.lineTo(tip.x - Math.cos(headingRad + 0.45) * 7, tip.y - Math.sin(headingRad + 0.45) * 7);
  ctx.closePath();
  ctx.fill();
}

/** How far the symbol reaches from its center, for placing things next to it. */
export function symbolReach(affiliation: Affiliation): Box {
  return frameBox(affiliation);
}

export function drawUnitSymbol(ctx: CanvasRenderingContext2D, at: Vec2, symbol: UnitSymbol): void {
  const box = frameBox(symbol.affiliation);
  if (symbol.headingRad !== null && symbol.destroyed === null) drawMovement(ctx, at, box, symbol.headingRad);
  if (symbol.selected) {
    ctx.strokeStyle = '#1060ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(at.x, at.y, Math.max(box.halfWidth, box.halfHeight) + 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  framePath(ctx, at, symbol.affiliation);
  if (!symbol.hollow) {
    ctx.fillStyle = FILLS[symbol.affiliation];
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  if (symbol.dashed || symbol.hollow) ctx.setLineDash([3, 2]);
  ctx.stroke();
  ctx.setLineDash([]);
  drawIcon(ctx, at, symbol);

  const top = at.y - box.halfHeight;
  if (symbol.echelon !== null) haloText(ctx, ECHELON_MARKS[symbol.echelon], at.x, top - 3, INK, 'bold 10px sans-serif', 'center');
  if (symbol.reduced) haloText(ctx, '(−)', at.x + box.halfWidth + 2, top + 2, INK, 'bold 10px sans-serif');
  if (symbol.condition !== null) {
    const width = box.halfWidth * 2;
    const y = at.y + box.halfHeight + 3;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(at.x - box.halfWidth - 1, y - 1, width + 2, 6);
    ctx.fillStyle = CONDITION_COLORS[symbol.condition.condition];
    ctx.fillRect(at.x - box.halfWidth, y, width * Math.max(0.15, 1 - symbol.condition.lostShare), 4);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.75;
    ctx.strokeRect(at.x - box.halfWidth, y, width, 4);
  }
  symbol.right.forEach((modifier, index) => {
    haloText(ctx, modifier.text, at.x + box.halfWidth + 4, at.y + 4 + (index - (symbol.right.length - 1) / 2) * 12, modifier.color ?? INK);
  });
  if (symbol.destroyed !== null) drawCross(ctx, at, box, symbol.destroyed === 'probable');
}
