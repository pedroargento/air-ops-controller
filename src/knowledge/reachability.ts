import type { PositionEstimate } from '../domain/public/estimates';
import type { Vec2 } from '../domain/public/geometry';

export type DisplayParameters = Readonly<{
  opacityFloor: number;
  fadeSeconds: number;
  plausibleSpeedMps: number;
  coneBaseHalfAngleRad: number;
  coneWidenRadPerSecond: number;
  regionMaxRadiusMeters: number;
  regionFadeSeconds: number;
}>;

/** A possible region (§7.1), not a calibrated probability contour. */
export type ReachableRegion =
  | Readonly<{ kind: 'circle'; center: Vec2; radiusMeters: number }>
  | Readonly<{
      kind: 'sector';
      origin: Vec2;
      headingRad: number;
      halfAngleRad: number;
      radiusMeters: number;
    }>;

export function markerOpacity(ageSeconds: number, display: DisplayParameters): number {
  const fade = 1 - ageSeconds / display.fadeSeconds;
  return Math.max(display.opacityFloor, Math.min(1, fade));
}

/** A region stops being useful once old, so it fades out while the marker itself stays. */
export function regionOpacity(ageSeconds: number, display: DisplayParameters): number {
  return Math.max(0, 1 - ageSeconds / display.regionFadeSeconds);
}

/** Uses only the received estimate and elapsed time, never a true trajectory. */
export function reachableRegion(
  position: PositionEstimate,
  ageSeconds: number,
  display: DisplayParameters,
): ReachableRegion {
  const speed = position.speedMps ?? display.plausibleSpeedMps;
  const radiusMeters = Math.min(display.regionMaxRadiusMeters, position.sigmaMeters + speed * ageSeconds);
  if (position.headingRad === null || position.speedMps === null) {
    return { kind: 'circle', center: position.center, radiusMeters };
  }
  return {
    kind: 'sector',
    origin: position.center,
    headingRad: position.headingRad,
    halfAngleRad: Math.min(
      Math.PI,
      display.coneBaseHalfAngleRad + display.coneWidenRadPerSecond * ageSeconds,
    ),
    radiusMeters,
  };
}
