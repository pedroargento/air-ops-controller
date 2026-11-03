import type { AircraftTelemetryEntry } from '../domain/public/air';

/*
 * The air status board an operations room keeps: for each aircraft, what it will be doing over
 * the next hour, from its telemetry alone. It answers "who can I send, and when?"
 */

export type BoardPhase = 'transit' | 'station' | 'return' | 'turnaround' | 'ready';

export type BoardSegment = Readonly<{ phase: BoardPhase; fromSeconds: number; toSeconds: number }>;

/** The phases ahead of an aircraft, clipped to the horizon, as if nobody gives it a new order. */
export function boardSegments(aircraft: AircraftTelemetryEntry, horizonSeconds: number): readonly BoardSegment[] {
  const plan: [BoardPhase, number][] = [];
  switch (aircraft.status) {
    case 'ready':
      break;
    case 'takeoff':
    case 'enroute':
      plan.push(['transit', aircraft.etaSeconds ?? 0], ['station', aircraft.stationSeconds ?? 0], ['return', aircraft.homeSeconds], ['turnaround', aircraft.turnaroundSeconds]);
      break;
    case 'onStation':
      plan.push(['station', aircraft.stationSeconds ?? 0], ['return', aircraft.homeSeconds], ['turnaround', aircraft.turnaroundSeconds]);
      break;
    case 'returning':
      plan.push(['return', aircraft.homeSeconds], ['turnaround', aircraft.turnaroundSeconds]);
      break;
    case 'turnaround':
      plan.push(['turnaround', aircraft.availableInSeconds]);
      break;
  }
  const segments: BoardSegment[] = [];
  let at = 0;
  for (const [phase, seconds] of plan) {
    if (seconds <= 0 || at >= horizonSeconds) continue;
    const end = Math.min(horizonSeconds, at + seconds);
    segments.push({ phase, fromSeconds: at, toSeconds: end });
    at = end;
  }
  if (at < horizonSeconds) segments.push({ phase: 'ready', fromSeconds: at, toSeconds: horizonSeconds });
  return segments;
}
