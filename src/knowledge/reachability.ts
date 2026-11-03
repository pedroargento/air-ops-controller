export type DisplayParameters = Readonly<{
  opacityFloor: number;
  fadeSeconds: number;
  plausibleSpeedMps: number;
}>;

/**
 * Markers fade with the age of what they show, down to a floor, and stay selectable. Where a
 * unit might have gone since is the player's own estimate (§7.1): the map draws no region.
 */
export function markerOpacity(ageSeconds: number, display: DisplayParameters): number {
  const fade = 1 - ageSeconds / display.fadeSeconds;
  return Math.max(display.opacityFloor, Math.min(1, fade));
}
