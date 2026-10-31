import { cos, PI, sin } from '../domain/public/det-math';
import type { Weather, WeatherSystem } from '../domain/public/weather';
import { nextFloat, nextGaussian, type RngState } from '../rng/streams';
import type { WeatherConfig } from '../scenario/schema';

const LABEL = 'weather';

function between(rng: RngState, low: number, high: number): number {
  return low + nextFloat(rng, LABEL) * (high - low);
}

/** The mission's weather, decided once at the start from the seed. */
export function generateWeather(config: WeatherConfig, worldSize: number, durationSeconds: number, rng: RngState): Weather {
  const count = Math.floor(between(rng, config.minSystems, config.maxSystems + 1));
  const bearing = between(rng, 0, PI * 2);
  const speed = between(rng, config.minWindMps, config.maxWindMps);
  const velocity = { x: cos(bearing) * speed, y: sin(bearing) * speed };
  const systems = Array.from({ length: count }, (): WeatherSystem => {
    const peak = between(rng, 0, durationSeconds);
    const span = between(rng, config.minSystemSeconds, config.maxSystemSeconds);
    const center = { x: between(rng, 0, worldSize), y: between(rng, 0, worldSize) };
    return {
      originAtTickZero: { x: center.x - velocity.x * peak, y: center.y - velocity.y * peak },
      velocity,
      radiusMeters: between(rng, config.minRadiusMeters, config.maxRadiusMeters),
      ceilingMeters: between(rng, config.minCeilingMeters, config.maxCeilingMeters),
      rain: between(rng, config.minRain, config.maxRain),
      fromTick: Math.round(peak - span / 2),
      untilTick: Math.round(peak + span / 2),
    };
  });
  return {
    baseCeilingMeters: config.baseCeilingMeters,
    systems,
    rampSeconds: config.rampSeconds,
    clearVisibilityMeters: config.clearVisibilityMeters,
    heavyRainVisibilityMeters: config.heavyRainVisibilityMeters,
    cloudFadeMeters: config.cloudFadeMeters,
    rainMissMeters: config.rainMissMeters,
  };
}

/**
 * A noisy copy of the plan, made from the truth now. A small wind error grows with lead
 * time, so near forecasts are good and far ones aren't, without any special case.
 */
export function issueForecast(weather: Weather, config: WeatherConfig, rng: RngState, tick: number): Weather {
  const windError = { x: nextGaussian(rng, LABEL) * config.forecastWindErrorMps, y: nextGaussian(rng, LABEL) * config.forecastWindErrorMps };
  const systems = weather.systems
    .filter((system) => system.untilTick >= tick)
    .map((system): WeatherSystem => {
      const velocity = { x: system.velocity.x + windError.x, y: system.velocity.y + windError.y };
      const shift = nextGaussian(rng, LABEL) * config.forecastTimingErrorSeconds;
      const now = {
        x: system.originAtTickZero.x + system.velocity.x * tick + nextGaussian(rng, LABEL) * config.forecastPositionErrorMeters,
        y: system.originAtTickZero.y + system.velocity.y * tick + nextGaussian(rng, LABEL) * config.forecastPositionErrorMeters,
      };
      return {
        ...system,
        velocity,
        originAtTickZero: { x: now.x - velocity.x * tick, y: now.y - velocity.y * tick },
        ceilingMeters: Math.max(100, system.ceilingMeters + nextGaussian(rng, LABEL) * config.forecastCeilingErrorMeters),
        untilTick: Math.round(system.untilTick + shift),
      };
    });
  return { ...weather, systems };
}
