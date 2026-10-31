import type { Vec2 } from '../domain/public/geometry';
import { systemCenterAt, weatherAt, type Weather, type WeatherSystem } from '../domain/public/weather';

export const TRACK_MARK_MINUTES = 15;
const BAND_STEP_METERS = 250;

export type ChartLevel = Readonly<{ ceilingMeters: number; color: string; rgb: readonly [number, number, number]; alpha: number }>;

/**
 * Bands are set against the aircraft in question, so red always means the same decision:
 * at this altitude you can't see the ground here. Higher levels warn it's getting close.
 */
export function chartLevels(altitudeMeters: number, baseCeilingMeters: number): readonly ChartLevel[] {
  const levels: readonly ChartLevel[] = [
    { ceilingMeters: altitudeMeters + BAND_STEP_METERS * 2, color: '#6fb7ff', rgb: [111, 183, 255], alpha: 0.2 },
    { ceilingMeters: altitudeMeters + BAND_STEP_METERS, color: '#ffd24a', rgb: [255, 210, 74], alpha: 0.28 },
    { ceilingMeters: altitudeMeters, color: '#ff4a3d', rgb: [255, 74, 61], alpha: 0.38 },
  ];
  return levels.filter((level) => level === levels[2] || level.ceilingMeters < baseCeilingMeters);
}

/** The most severe level this ceiling falls under, or null above them all. */
export function levelFor(ceilingMeters: number, levels: readonly ChartLevel[]): ChartLevel | null {
  let found: ChartLevel | null = null;
  for (const level of levels) if (ceilingMeters < level.ceilingMeters) found = level;
  return found;
}

/** How far from a storm's center the cloud base is under this altitude, at full strength. */
export function lowCloudRadius(system: WeatherSystem, baseCeilingMeters: number, altitudeMeters: number): number {
  if (system.ceilingMeters >= altitudeMeters) return 0;
  if (altitudeMeters >= baseCeilingMeters) return system.radiusMeters;
  const strength = (baseCeilingMeters - altitudeMeters) / (baseCeilingMeters - system.ceilingMeters);
  return system.radiusMeters * Math.sqrt(1 - strength);
}

export type RainClass = Readonly<{ name: string; everyCells: number; lengthPixels: number }>;

/** Rain marks get denser and longer with strength, so heavy rain reads differently from light. */
export function rainClass(rain: number): RainClass | null {
  if (rain >= 0.65) return { name: 'heavy', everyCells: 1, lengthPixels: 6 };
  if (rain >= 0.35) return { name: 'moderate', everyCells: 2, lengthPixels: 4 };
  if (rain >= 0.1) return { name: 'light', everyCells: 4, lengthPixels: 3 };
  return null;
}

export type ForecastError = Readonly<{ windMps: number; positionMeters: number }>;

export type StormTrack = Readonly<{
  from: Vec2;
  to: Vec2;
  /** Time marks counted from now, so the player can read when it gets somewhere. */
  marks: readonly Readonly<{ minutes: number; position: Vec2 }>[];
  /** Minutes until it forms; 0 once it exists. */
  formsInMinutes: number;
  /** Half-width of the likely path: the low cloud plus forecast error since issue. */
  fromHalfWidth: number;
  toHalfWidth: number;
}>;

/** Each storm's forecast path from now until it dies out. Read from the forecast alone. */
export function stormTracks(
  forecast: Weather,
  nowTick: number,
  issuedTick: number,
  altitudeMeters: number,
  error: ForecastError,
): readonly StormTrack[] {
  const tracks: StormTrack[] = [];
  for (const system of forecast.systems) {
    const startTick = Math.max(nowTick, system.fromTick);
    if (system.untilTick <= startTick) continue;
    const marks: { minutes: number; position: Vec2 }[] = [];
    for (let minutes = TRACK_MARK_MINUTES; nowTick + minutes * 60 < system.untilTick; minutes += TRACK_MARK_MINUTES) {
      const tick = nowTick + minutes * 60;
      if (tick > startTick) marks.push({ minutes, position: systemCenterAt(system, tick) });
    }
    const core = lowCloudRadius(system, forecast.baseCeilingMeters, altitudeMeters);
    const halfWidthAt = (tick: number): number => core + error.positionMeters + error.windMps * Math.max(0, tick - issuedTick);
    tracks.push({
      from: systemCenterAt(system, startTick),
      to: systemCenterAt(system, system.untilTick),
      marks,
      formsInMinutes: Math.round((startTick - nowTick) / 60),
      fromHalfWidth: halfWidthAt(startTick),
      toHalfWidth: halfWidthAt(system.untilTick),
    });
  }
  return tracks;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** One wind moves every storm, so one line describes them all. North is toward -y. */
export function stormMovement(forecast: Weather): string | null {
  const system = forecast.systems[0];
  if (system === undefined) return null;
  const { x, y } = system.velocity;
  const degrees = (Math.atan2(x, -y) * 180) / Math.PI;
  const point = COMPASS[Math.round(((degrees + 360) % 360) / 45) % COMPASS.length];
  return `moving ${point}, ${Math.round(Math.hypot(x, y) * 3.6)} km/h`;
}

export type CeilingField = Readonly<{ columns: number; rows: number; stepMeters: number; ceilings: Float64Array }>;

export function ceilingField(forecast: Weather, tick: number, worldSize: number, stepMeters: number): CeilingField {
  const columns = Math.ceil(worldSize / stepMeters) + 1;
  const ceilings = new Float64Array(columns * columns);
  for (let row = 0; row < columns; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      ceilings[row * columns + column] = weatherAt(forecast, { x: column * stepMeters, y: row * stepMeters }, tick).ceilingMeters;
    }
  }
  return { columns, rows: columns, stepMeters, ceilings };
}

export type Segment = readonly [Vec2, Vec2];

/** Marching squares: the line where the field crosses a level, as loose segments. */
export function contourSegments(field: CeilingField, level: number): readonly Segment[] {
  const { columns, rows, stepMeters, ceilings } = field;
  const at = (column: number, row: number): number => ceilings[row * columns + column] ?? 0;
  const crossing = (a: Vec2, b: Vec2, valueA: number, valueB: number): Vec2 | null => {
    if (valueA < level === valueB < level) return null;
    const t = (level - valueA) / (valueB - valueA);
    return { x: (a.x + (b.x - a.x) * t) * stepMeters, y: (a.y + (b.y - a.y) * t) * stepMeters };
  };
  const segments: Segment[] = [];
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const corners = [
        { x: column, y: row },
        { x: column + 1, y: row },
        { x: column + 1, y: row + 1 },
        { x: column, y: row + 1 },
      ] as const;
      const values = [at(column, row), at(column + 1, row), at(column + 1, row + 1), at(column, row + 1)] as const;
      const points = [
        crossing(corners[0], corners[1], values[0], values[1]),
        crossing(corners[1], corners[2], values[1], values[2]),
        crossing(corners[2], corners[3], values[2], values[3]),
        crossing(corners[3], corners[0], values[3], values[0]),
      ].filter((point) => point !== null);
      for (let index = 0; index + 1 < points.length; index += 2) {
        const [a, b] = [points[index], points[index + 1]];
        if (a !== undefined && b !== undefined) segments.push([a, b]);
      }
    }
  }
  return segments;
}
