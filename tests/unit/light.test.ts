import { describe, expect, it } from 'vitest';
import { aimFactor, ambientLight, flareLight, lightAt, lightState, nextFirstLight, sightFactor, type Flare, type Sky } from '../../src/domain/public/light';

const hour = 3600;
const night: Sky = {
  startSecondsOfDay: 2 * hour,
  sunriseSeconds: 6 * hour,
  sunsetSeconds: 19 * hour,
  twilightSeconds: 1800,
  moonIllumination: 0.5,
  moonriseSeconds: 20 * hour,
  moonsetSeconds: 3 * hour,
  starlight: 0.03,
  fullMoonLight: 0.25,
  cloudDimming: 0.7,
  nightSightFloor: 0.2,
  flashSight: 0.6,
  nightAimFloor: 0.3,
};

describe('the sky', () => {
  it('is full light by day and little at night, more with the moon up, less under rain', () => {
    expect(ambientLight(night, 10 * hour, 0)).toBe(1);
    expect(ambientLight(night, 0, 0)).toBeCloseTo(0.03 + 0.125);
    expect(ambientLight(night, 1.5 * hour, 0)).toBeCloseTo(0.03);
    expect(ambientLight(night, 0, 1)).toBeCloseTo((0.03 + 0.125) * 0.3);
  });

  it('brightens through twilight before sunrise', () => {
    const dark = ambientLight(night, 3 * hour, 0);
    const dawn = ambientLight(night, 3.75 * hour, 0);
    expect(dawn).toBeGreaterThan(dark);
    expect(dawn).toBeLessThan(1);
    expect(lightState(night, 0)).toBe('night');
    expect(lightState(night, 3.75 * hour)).toBe('twilight');
    expect(nextFirstLight(night, 0)).toBe(3.5 * hour);
  });
});

describe('flares', () => {
  const flare: Flare = { position: { x: 0, y: 0 }, ignitedAt: 100, burnSeconds: 180, radiusMeters: 900, light: 0.7, by: 'O-1' };

  it('light the middle fully, fade to the edge, and dim as they burn out', () => {
    expect(flareLight(flare, { x: 300, y: 0 }, 110)).toBeCloseTo(0.7);
    expect(flareLight(flare, { x: 675, y: 0 }, 110)).toBeCloseTo(0.35);
    expect(flareLight(flare, { x: 1000, y: 0 }, 110)).toBe(0);
    expect(flareLight(flare, { x: 0, y: 0 }, 262)).toBeLessThan(0.7);
    expect(flareLight(flare, { x: 0, y: 0 }, 400)).toBe(0);
  });

  it('give the brighter of the sky and any flare', () => {
    expect(lightAt(night, [flare], { x: 0, y: 0 }, 110, 0)).toBeCloseTo(0.7);
    expect(lightAt(night, [flare], { x: 5000, y: 0 }, 110, 0)).toBeCloseTo(0.03 + 0.125);
  });
});

describe('what light does', () => {
  it('leaves everything as it is by day', () => {
    expect(sightFactor(night, 1, false)).toBe(1);
    expect(aimFactor(night, 1, false)).toBe(1);
  });

  it('cuts sight and aim in the dark, except for a unit showing its muzzle flashes', () => {
    expect(sightFactor(night, 0.03, false)).toBe(0.2);
    expect(sightFactor(night, 0.03, true)).toBe(0.6);
    expect(aimFactor(night, 0.03, false)).toBeLessThan(aimFactor(night, 0.03, true));
  });
});
