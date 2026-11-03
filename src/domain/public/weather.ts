import { exp, hypot, log } from './det-math';
import { distance, type Vec2 } from './geometry';
import { hasAirLos, type TerrainGrid } from './terrain';
import type { Sky } from './light';

/** A storm: one wind moves every system, so the sky has a pattern a player can read. */
export type WeatherSystem = Readonly<{
  originAtTickZero: Vec2;
  velocity: Vec2;
  radiusMeters: number;
  ceilingMeters: number;
  rain: number;
  fromTick: number;
  untilTick: number;
}>;

// The whole mission's weather, fixed at the start. A forecast has the same shape with
// errors in it, so the overlay and the real weather are two readings of one kind of plan.
export type Weather = Readonly<{
  baseCeilingMeters: number;
  systems: readonly WeatherSystem[];
  rampSeconds: number;
  /** How far anyone can see in dry air, and at the heaviest rain. */
  clearVisibilityMeters: number;
  heavyRainVisibilityMeters: number;
  /** Sight starts to go this far under the cloud base and is gone at it. */
  cloudFadeMeters: number;
  rainMissMeters: number;
  /** The day's ephemeris: when it's light, and how much the moon gives at night. */
  sky: Sky;
}>;

export type LocalWeather = Readonly<{ ceilingMeters: number; rain: number }>;

/** Where a storm's center is at any time, whether or not it exists yet. */
export function systemCenterAt(system: WeatherSystem, tick: number): Vec2 {
  return {
    x: system.originAtTickZero.x + system.velocity.x * tick,
    y: system.originAtTickZero.y + system.velocity.y * tick,
  };
}

function systemStrength(system: WeatherSystem, point: Vec2, tick: number, rampSeconds: number): number {
  if (tick < system.fromTick || tick > system.untilTick) return 0;
  const ramp = Math.min((tick - system.fromTick) / rampSeconds, (system.untilTick - tick) / rampSeconds, 1);
  const edge = Math.max(0, 1 - distance(systemCenterAt(system, tick), point) / system.radiusMeters);
  return ramp * edge * (2 - edge);
}

/** Works for any time, past or future, so a forecast can be read at any lead. */
export function weatherAt(weather: Weather, point: Vec2, tick: number): LocalWeather {
  let ceilingMeters = weather.baseCeilingMeters;
  let rain = 0;
  for (const system of weather.systems) {
    const strength = systemStrength(system, point, tick, weather.rampSeconds);
    ceilingMeters = Math.min(ceilingMeters, weather.baseCeilingMeters - (weather.baseCeilingMeters - system.ceilingMeters) * strength);
    rain = Math.max(rain, system.rain * strength);
  }
  return { ceilingMeters, rain };
}

/** Rain strength as a distance: each step of rain cuts how far you can see by the same share. */
export function rainVisibilityMeters(weather: Weather, rain: number): number {
  if (rain <= 0) return weather.clearVisibilityMeters;
  return weather.clearVisibilityMeters * exp(rain * log(weather.heavyRainVisibilityMeters / weather.clearVisibilityMeters));
}

/** How far one point on the ground can see another, through the worse rain of the two. */
export function groundVisibilityMeters(weather: Weather, a: Vec2, b: Vec2, tick: number): number {
  return rainVisibilityMeters(weather, Math.max(weatherAt(weather, a, tick).rain, weatherAt(weather, b, tick).rain));
}

/** How far sight carries between an aircraft and the ground: rain, then closeness to cloud. */
export function airVisibilityMeters(weather: Weather, ground: Vec2, air: Vec2, altitudeMeters: number, tick: number): number {
  const local = weatherAt(weather, ground, tick);
  const clearance = (local.ceilingMeters - altitudeMeters) / weather.cloudFadeMeters;
  if (clearance <= 0) return 0;
  const rain = Math.max(local.rain, weatherAt(weather, air, tick).rain);
  return rainVisibilityMeters(weather, rain) * Math.min(1, clearance);
}

/**
 * A sensor's reach in poor visibility: always less than in clear air and never more than
 * the visibility, so light rain costs a little and heavy rain a lot, with no steps.
 */
export function rangeInVisibility(rangeMeters: number, visibilityMeters: number, clearVisibilityMeters: number): number {
  if (visibilityMeters <= 0) return 0;
  return 1 / (1 / rangeMeters + 1 / visibilityMeters - 1 / clearVisibilityMeters);
}

/** Terrain, cloud and rain all stand between the ground and an aircraft (§8.4, §8.6). */
export function airSightClear(
  terrain: TerrainGrid,
  weather: Weather,
  ground: Vec2,
  air: Vec2,
  altitudeMeters: number,
  tick: number,
): boolean {
  const slant = hypot(distance(ground, air), altitudeMeters);
  if (slant > airVisibilityMeters(weather, ground, air, altitudeMeters, tick)) return false;
  return hasAirLos(terrain, ground, air, altitudeMeters);
}
