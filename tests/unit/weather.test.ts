import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import { distance } from '../../src/domain/public/geometry';
import {
  airSightClear,
  airVisibilityMeters,
  groundVisibilityMeters,
  rainVisibilityMeters,
  rangeInVisibility,
  weatherAt,
  type Weather,
  type WeatherSystem,
} from '../../src/domain/public/weather';
import { createRng } from '../../src/rng/streams';
import { createInitialState } from '../../src/sim/state';
import { generateWeather, issueForecast } from '../../src/sim/weather';

const scenario = loadScenarioFile();
const config = scenario.file.weather;
const clear = { x: 2500, y: 2500 };

const storm: Weather = {
  baseCeilingMeters: 2500,
  rampSeconds: 300,
  clearVisibilityMeters: 8000,
  heavyRainVisibilityMeters: 300,
  cloudFadeMeters: 200,
  rainMissMeters: 80,
  systems: [
    {
      originAtTickZero: { x: 0, y: 2500 },
      velocity: { x: 2, y: 0 },
      radiusMeters: 1000,
      ceilingMeters: 500,
      rain: 0.8,
      fromTick: 0,
      untilTick: 3000,
    },
  ],
};

import {
  ceilingField,
  chartLevels,
  contourSegments,
  levelFor,
  lowCloudRadius,
  rainClass,
  stormMovement,
  stormTracks,
} from '../../src/ui/weather-chart';

describe('weather', () => {
  it('moves with the wind: a storm reaches a point, then leaves it', () => {
    const point = { x: 2000, y: 2500 };
    expect(weatherAt(storm, point, 400).rain).toBe(0);
    expect(weatherAt(storm, point, 1000).rain).toBeGreaterThan(0.7);
    expect(weatherAt(storm, point, 1600).rain).toBe(0);
  });

  it('changes smoothly in time and space, with no rain from nowhere', () => {
    let last = weatherAt(storm, clear, 400).ceilingMeters;
    for (let tick = 405; tick < 2000; tick += 5) {
      const now = weatherAt(storm, clear, tick).ceilingMeters;
      expect(Math.abs(now - last)).toBeLessThan(60);
      last = now;
    }
  });

  it('builds up and fades out at the ends of a system\'s life', () => {
    const center = (tick: number) => ({ x: 2 * tick, y: 2500 });
    expect(weatherAt(storm, center(60), 60).rain).toBeLessThan(weatherAt(storm, center(600), 600).rain);
    expect(weatherAt(storm, center(2990), 2990).rain).toBeLessThan(0.1);
    expect(weatherAt(storm, center(3100), 3100).rain).toBe(0);
  });

  it('keeps the base ceiling away from any storm', () => {
    expect(weatherAt(storm, { x: 4900, y: 100 }, 100)).toEqual({ ceilingMeters: 2500, rain: 0 });
  });

  it('is decided once, from the seed, with one wind for every system', () => {
    const make = (seed: number) => generateWeather(config, 5000, 4500, createRng(seed));
    expect(make(4)).toEqual(make(4));
    expect(make(4)).not.toEqual(make(5));
    for (let seed = 0; seed < 30; seed += 1) {
      const { systems } = make(seed);
      expect(systems.length).toBeGreaterThanOrEqual(config.minSystems);
      expect(systems.length).toBeLessThanOrEqual(config.maxSystems);
      expect(new Set(systems.map((s) => JSON.stringify(s.velocity))).size).toBeLessThanOrEqual(1);
    }
  });

  it('cloud cuts sight to aircraft above it, not below it', () => {
    const { terrain } = scenario;
    const under = { x: 2000, y: 2500 };
    const flat = { ...terrain, elevation: new Float32Array(terrain.elevation.length) };
    expect(airSightClear(flat, storm, under, under, 2000, 1000)).toBe(false);
    expect(airSightClear(flat, storm, under, under, 250, 1000)).toBe(true);
    // Just under the base, in this much rain, the aircraft still can't see the ground.
    expect(airSightClear(flat, storm, under, under, 400, 1000)).toBe(false);
  });

  it('turns rain strength into visibility, step by step', () => {
    expect(rainVisibilityMeters(storm, 0)).toBe(8000);
    expect(rainVisibilityMeters(storm, 1)).toBeCloseTo(300);
    const steps = [0, 0.2, 0.4, 0.6, 0.8, 1].map((rain) => rainVisibilityMeters(storm, rain));
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index]).toBeLessThan(steps[index - 1] ?? 0);
    }
    expect(rainVisibilityMeters(storm, 0.4)).toBeGreaterThan(1500);
    expect(rainVisibilityMeters(storm, 0.9)).toBeLessThan(500);
  });

  it('takes the worse rain of the two ends of a ground sight line', () => {
    const wet = { x: 2000, y: 2500 };
    const dry = { x: 4900, y: 100 };
    expect(groundVisibilityMeters(storm, dry, dry, 1000)).toBe(8000);
    expect(groundVisibilityMeters(storm, wet, dry, 1000)).toBe(groundVisibilityMeters(storm, dry, wet, 1000));
    expect(groundVisibilityMeters(storm, wet, dry, 1000)).toBeLessThan(1000);
  });

  it('loses sight smoothly on the way up to the cloud base', () => {
    const dry = { ...storm, systems: [], baseCeilingMeters: 1000 };
    const at = (meters: number): number => airVisibilityMeters(dry, clear, clear, meters, 0);
    expect(at(700)).toBe(8000);
    expect(at(900)).toBeCloseTo(4000);
    expect(at(980)).toBeCloseTo(800);
    expect(at(1000)).toBe(0);
    expect(at(1100)).toBe(0);
  });

  it('shortens a sensor gradually, never past the visibility', () => {
    expect(rangeInVisibility(900, 8000, 8000)).toBeCloseTo(900);
    expect(rangeInVisibility(900, 2000, 8000)).toBeLessThan(900);
    expect(rangeInVisibility(900, 2000, 8000)).toBeGreaterThan(rangeInVisibility(900, 500, 8000));
    expect(rangeInVisibility(900, 400, 8000)).toBeLessThan(400);
    expect(rangeInVisibility(900, 0, 8000)).toBe(0);
  });

  it('makes an aircraft come down to see through heavy rain', () => {
    const { terrain } = scenario;
    const flat = { ...terrain, elevation: new Float32Array(terrain.elevation.length) };
    const heavy = { ...storm, baseCeilingMeters: 3000, systems: [{ ...storm.systems[0]!, ceilingMeters: 2000, rain: 0.9, velocity: { x: 0, y: 0 }, originAtTickZero: clear, fromTick: 0, untilTick: 2000 }] };
    expect(airSightClear(flat, heavy, clear, clear, 650, 1000)).toBe(false);
    expect(airSightClear(flat, heavy, clear, clear, 300, 1000)).toBe(true);
  });
});

describe('forecast', () => {
  const center = (weather: Weather, tick: number) => {
    const system = weather.systems[0];
    if (system === undefined) throw new Error('no system');
    return {
      x: system.originAtTickZero.x + system.velocity.x * tick,
      y: system.originAtTickZero.y + system.velocity.y * tick,
    };
  };

  it('gets worse the further ahead it looks', () => {
    const errors = (lead: number): number => {
      let total = 0;
      for (let seed = 0; seed < 200; seed += 1) {
        const forecast = issueForecast(storm, config, createRng(seed), 500);
        total += distance(center(forecast, 500 + lead), center(storm, 500 + lead));
      }
      return total / 200;
    };
    expect(errors(2400)).toBeGreaterThan(errors(0) * 2);
  });

  it('leaves out systems that are already over', () => {
    expect(issueForecast(storm, config, createRng(1), 4000).systems).toEqual([]);
  });

  it('reaches the player as an update, and the true weather stays out of the view', () => {
    const state = createInitialState(scenario, 1);
    expect(state.player.forecast).toBeNull();
    expect(state.truth.weather.systems.length).toBeGreaterThan(0);
  });
});

describe('rain marks', () => {
  it('get denser with strength', () => {
    expect(rainClass(0.05)).toBeNull();
    const names = [0.2, 0.5, 0.9].map((rain) => rainClass(rain));
    expect(names.map((rain) => rain?.name)).toEqual(['light', 'moderate', 'heavy']);
    expect(names.map((rain) => rain?.everyCells)).toEqual([4, 2, 1]);
  });
});

describe('forecast chart', () => {
  const system: WeatherSystem = {
    originAtTickZero: { x: 0, y: 2000 },
    velocity: { x: 2, y: 0 },
    radiusMeters: 2000,
    ceilingMeters: 500,
    rain: 0.5,
    fromTick: 0,
    untilTick: 2000,
  };
  const forecast: Weather = { baseCeilingMeters: 1600, systems: [system], rampSeconds: 1, clearVisibilityMeters: 8000, heavyRainVisibilityMeters: 300, cloudFadeMeters: 200, rainMissMeters: 80 };
  const error = { windMps: 0.5, positionMeters: 100 };

  it('tracks a storm from now to where it dies out, with marks counted from now', () => {
    const [track] = stormTracks(forecast, 600, 600, 650, error);
    expect(track?.from).toEqual({ x: 1200, y: 2000 });
    expect(track?.to).toEqual({ x: 4000, y: 2000 });
    expect(track?.marks).toEqual([{ minutes: 15, position: { x: 3000, y: 2000 } }]);
    expect(track?.formsInMinutes).toBe(0);
  });

  it('starts a storm that has not formed yet where it will form, and drops finished ones', () => {
    const late = { ...forecast, systems: [{ ...system, fromTick: 1200 }] };
    expect(stormTracks(late, 600, 600, 650, error)[0]?.formsInMinutes).toBe(10);
    expect(stormTracks(late, 600, 600, 650, error)[0]?.from).toEqual({ x: 2400, y: 2000 });
    expect(stormTracks(forecast, 2000, 0, 650, error)).toEqual([]);
  });

  it('widens the likely path with time since the forecast was issued', () => {
    const [track] = stormTracks(forecast, 600, 0, 650, error);
    expect((track?.toHalfWidth ?? 0) - (track?.fromHalfWidth ?? 0)).toBeCloseTo(0.5 * 1400);
  });

  it('puts the low-cloud radius where the cloud base really crosses the altitude', () => {
    const radius = lowCloudRadius(system, 1600, 650);
    const edge = weatherAt(forecast, { x: 1000 + radius, y: 2000 }, 500).ceilingMeters;
    expect(edge).toBeCloseTo(650, 0);
    expect(lowCloudRadius(system, 1600, 400)).toBe(0);
    expect(lowCloudRadius(system, 1600, 2000)).toBe(2000);
  });

  it('reports movement by compass, with north toward the top of the map', () => {
    expect(stormMovement(forecast)).toBe('moving E, 7 km/h');
    const northeast = { ...system, velocity: { x: 1, y: -1 } };
    expect(stormMovement({ ...forecast, systems: [northeast] })).toBe('moving NE, 5 km/h');
    expect(stormMovement({ ...forecast, systems: [] })).toBeNull();
  });

  it('sets red at the aircraft altitude and drops bands above the clear-sky base', () => {
    const levels = chartLevels(650, 1600);
    expect(levels.map((level) => level.ceilingMeters)).toEqual([1150, 900, 650]);
    expect(levelFor(600, levels)?.ceilingMeters).toBe(650);
    expect(levelFor(800, levels)?.ceilingMeters).toBe(900);
    expect(levelFor(1200, levels)).toBeNull();
    expect(chartLevels(2000, 1600).map((level) => level.ceilingMeters)).toEqual([2000]);
  });

  it('contours around a storm and not across clear sky', () => {
    const field = ceilingField(forecast, 1000, 4000, 100);
    const segments = contourSegments(field, 650);
    expect(segments.length).toBeGreaterThan(0);
    const center = { x: 2000, y: 2000 };
    const radius = lowCloudRadius(system, 1600, 650);
    for (const [a] of segments) expect(Math.hypot(a.x - center.x, a.y - center.y)).toBeCloseTo(radius, -2);
    expect(contourSegments(ceilingField({ ...forecast, systems: [] }, 0, 4000, 100), 650)).toEqual([]);
  });
});
