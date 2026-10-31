import type { AircraftTelemetryEntry } from '../domain/public/air';
import { distance, type Vec2 } from '../domain/public/geometry';
import { elevationAt, type TerrainGrid } from '../domain/public/terrain';
import { distanceText } from './format';

const SAMPLES = 90;
const MARGIN_METERS = 150;

export type PathPoint = Readonly<{ fraction: number; ground: number }>;

/** Where a path crosses the map: terrain means nothing off the edge, during long transits. */
export function clipToMap(from: Vec2, to: Vec2, worldSize: number): Readonly<{ start: Vec2; end: Vec2 }> | null {
  const inside = (p: Vec2): boolean => p.x >= 0 && p.y >= 0 && p.x < worldSize && p.y < worldSize;
  let start: Vec2 | null = null;
  let end: Vec2 | null = null;
  for (let i = 0; i <= SAMPLES * 4; i += 1) {
    const t = i / (SAMPLES * 4);
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (!inside(point)) continue;
    start ??= point;
    end = point;
  }
  return start === null || end === null ? null : { start, end };
}

export function groundAlong(terrain: TerrainGrid, start: Vec2, end: Vec2): readonly PathPoint[] {
  return Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const fraction = i / SAMPLES;
    const point = { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction };
    return { fraction, ground: elevationAt(terrain, point) };
  });
}

/** The ground the selected aircraft will fly over, against the height it is flying at. */
export class PathProfile {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly terrain: TerrainGrid,
  ) {
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Canvas 2D is unavailable');
    this.ctx = context;
  }

  render(aircraft: AircraftTelemetryEntry | null, destination: Vec2 | null): void {
    const { canvas, terrain } = this;
    const path =
      aircraft === null || destination === null
        ? null
        : clipToMap(aircraft.position, destination, terrain.width * terrain.cellSize);
    canvas.hidden = path === null;
    if (path === null || aircraft === null) return;
    const width = canvas.clientWidth;
    if (canvas.width !== width) canvas.width = width;
    this.draw(aircraft, groundAlong(terrain, path.start, path.end), distance(path.start, path.end));
  }

  private draw(aircraft: AircraftTelemetryEntry, points: readonly PathPoint[], meters: number): void {
    const { ctx, canvas } = this;
    const { altitudeMeters: altitude, targetAltitudeMeters: target } = aircraft;
    const top = Math.max(altitude, target, ...points.map((p) => p.ground)) + MARGIN_METERS;
    const y = (height: number): number => canvas.height - 4 - (height / top) * (canvas.height - 14);
    const x = (fraction: number): number => fraction * canvas.width;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    for (const point of points) ctx.lineTo(x(point.fraction), y(point.ground));
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.fillStyle = '#6d7f55';
    ctx.fill();
    ctx.strokeStyle = aircraft.aircraftType === 'cas' ? '#ffe066' : '#66e0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y(altitude));
    ctx.lineTo(canvas.width, y(target));
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '11px monospace';
    ctx.fillText(`${aircraft.aircraftId} ${Math.round(altitude)} m · path ${distanceText(Math.round(meters / 100) * 100)}`, 6, 12);
  }
}
