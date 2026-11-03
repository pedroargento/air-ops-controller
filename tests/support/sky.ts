import type { Sky } from '../../src/domain/public/light';

/** A sky that stays daylight all mission, for tests that aren't about light. */
export const DAY_SKY: Sky = {
  startSecondsOfDay: 12 * 3600,
  sunriseSeconds: 5 * 3600,
  sunsetSeconds: 19 * 3600,
  twilightSeconds: 1800,
  moonIllumination: 0.3,
  moonriseSeconds: 18 * 3600,
  moonsetSeconds: 4 * 3600,
  starlight: 0.03,
  fullMoonLight: 0.25,
  cloudDimming: 0.7,
  nightSightFloor: 0.2,
  flashSight: 0.6,
  nightAimFloor: 0.3,
};
