/** Moves the playhead by real elapsed time, in simulated seconds, and stops at the end. */
export function advancePlayhead(
  playhead: number,
  elapsedMs: number,
  speed: number,
  lastFrame: number,
): number {
  return Math.min(lastFrame, playhead + (elapsedMs / 1000) * speed);
}
