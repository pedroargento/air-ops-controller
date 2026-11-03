import { distance, type Vec2 } from './geometry';

/*
 * Light (§8.7). Darkness is a shortage of light, and light is what lets anyone see or aim:
 * the sun, the moon through the cloud, and flares. It scales how far an observer can see, and
 * so how well, through the same channel as weather.
 */

/** The day's ephemeris, as a forecast gives it: all times as seconds of the day. */
export type Sky = Readonly<{
  /** Seconds of the day when the mission starts, so ticks can be read as times of day. */
  startSecondsOfDay: number;
  sunriseSeconds: number;
  sunsetSeconds: number;
  /** How long twilight lasts either side of sunrise and sunset. */
  twilightSeconds: number;
  /** Share of the moon's face lit, 0 new to 1 full. */
  moonIllumination: number;
  moonriseSeconds: number;
  moonsetSeconds: number;
  /** Light on a moonless night and under a full moon, as shares of daylight's usefulness. */
  starlight: number;
  fullMoonLight: number;
  /** How much of the night's light heavy rain and its cloud take away. */
  cloudDimming: number;
  /** Least sight reach in the dark, a firing unit's, and the least aim, as shares of daylight's. */
  nightSightFloor: number;
  flashSight: number;
  nightAimFloor: number;
}>;

export type Flare = Readonly<{
  position: Vec2;
  ignitedAt: number;
  burnSeconds: number;
  radiusMeters: number;
  /** Light at its center, as a share of daylight. */
  light: number;
  by: string;
}>;

const DAY = 86400;

function timeOfDay(sky: Sky, tick: number): number {
  return (((sky.startSecondsOfDay + tick) % DAY) + DAY) % DAY;
}

/** Whether a time of day falls between two others, across midnight if need be. */
function between(time: number, from: number, until: number): boolean {
  return from <= until ? time >= from && time < until : time >= from || time < until;
}

/** How light the sky makes things, anywhere, before flares: 1 by day, little at night. */
export function ambientLight(sky: Sky, tick: number, rain: number): number {
  const time = timeOfDay(sky, tick);
  if (between(time, sky.sunriseSeconds, sky.sunsetSeconds)) return 1;
  const moonUp = between(time, sky.moonriseSeconds, sky.moonsetSeconds);
  const night = (sky.starlight + (moonUp ? sky.fullMoonLight * sky.moonIllumination : 0)) * (1 - sky.cloudDimming * rain);
  const sinceSunset = (((time - sky.sunsetSeconds) % DAY) + DAY) % DAY;
  const toSunrise = (((sky.sunriseSeconds - time) % DAY) + DAY) % DAY;
  const twilight = Math.max(0, 1 - Math.min(sinceSunset, toSunrise) / sky.twilightSeconds);
  return night + (1 - night) * twilight;
}

/** A flare's light at a point: full across the middle, fading to the edge, and dimming as it burns out. */
export function flareLight(flare: Flare, point: Vec2, tick: number): number {
  const age = tick - flare.ignitedAt;
  if (age < 0 || age > flare.burnSeconds) return 0;
  const gap = distance(flare.position, point);
  if (gap >= flare.radiusMeters) return 0;
  const reach = gap <= flare.radiusMeters / 2 ? 1 : 2 * (1 - gap / flare.radiusMeters);
  const left = flare.burnSeconds - age;
  const burning = Math.min(1, left / (flare.burnSeconds * 0.2));
  return flare.light * reach * burning;
}

export function lightAt(sky: Sky, flares: readonly Flare[], point: Vec2, tick: number, rain: number): number {
  let light = ambientLight(sky, tick, rain);
  for (const flare of flares) light = Math.max(light, flareLight(flare, point, tick));
  return light;
}

/**
 * How far sight reaches, as a share of daylight's. A unit that is firing shows its muzzle
 * flashes, so it can be seen in the dark: the reason to hold fire at night.
 */
export function sightFactor(sky: Sky, light: number, firing: boolean): number {
  const seen = Math.max(sky.nightSightFloor, Math.min(1, Math.sqrt(Math.max(0, light))));
  return firing ? Math.max(seen, sky.flashSight) : seen;
}

/** How well fire lands, as a share of daylight's: men in the dark shoot at flashes and noise. */
export function aimFactor(sky: Sky, light: number, firing: boolean): number {
  return sky.nightAimFloor + (1 - sky.nightAimFloor) * sightFactor(sky, light, firing);
}

/** The light state in words, for the header. */
export function lightState(sky: Sky, tick: number): 'day' | 'twilight' | 'night' {
  const light = ambientLight(sky, tick, 0);
  if (light >= 1) return 'day';
  return light > sky.starlight + sky.fullMoonLight ? 'twilight' : 'night';
}

/** When the sky next gets light, as a tick: for "first light 0512". */
export function nextFirstLight(sky: Sky, tick: number): number {
  const time = timeOfDay(sky, tick);
  const dawn = sky.sunriseSeconds - sky.twilightSeconds;
  return tick + ((((dawn - time) % DAY) + DAY) % DAY);
}

export function isMoonUp(sky: Sky, tick: number): boolean {
  return between(timeOfDay(sky, tick), sky.moonriseSeconds, sky.moonsetSeconds);
}
