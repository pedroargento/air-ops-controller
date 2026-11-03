import { describe, expect, it } from 'vitest';
import type { AircraftTelemetryEntry } from '../../src/domain/public/air';
import { boardSegments } from '../../src/ui/status-board';

const entry = (overrides: Partial<AircraftTelemetryEntry>): AircraftTelemetryEntry =>
  ({ status: 'ready', etaSeconds: null, stationSeconds: null, homeSeconds: 0, turnaroundSeconds: 600, availableInSeconds: 0, ...overrides }) as AircraftTelemetryEntry;

describe('air status board', () => {
  it('shows a ready aircraft as ready for the whole hour', () => {
    expect(boardSegments(entry({}), 3600)).toEqual([{ phase: 'ready', fromSeconds: 0, toSeconds: 3600 }]);
  });

  it('lays out the sortie ahead: transit, station, return, rearm, then ready', () => {
    const flying = entry({ status: 'enroute', etaSeconds: 300, stationSeconds: 1200, homeSeconds: 400, turnaroundSeconds: 600 });
    expect(boardSegments(flying, 3600).map((s) => [s.phase, s.fromSeconds, s.toSeconds])).toEqual([
      ['transit', 0, 300],
      ['station', 300, 1500],
      ['return', 1500, 1900],
      ['turnaround', 1900, 2500],
      ['ready', 2500, 3600],
    ]);
  });

  it('clips to the horizon', () => {
    const long = entry({ status: 'onStation', stationSeconds: 5000, homeSeconds: 400 });
    expect(boardSegments(long, 3600)).toEqual([{ phase: 'station', fromSeconds: 0, toSeconds: 3600 }]);
  });

  it('counts down the turnaround of an aircraft on the ground', () => {
    expect(boardSegments(entry({ status: 'turnaround', availableInSeconds: 900 }), 3600)[0]).toEqual({ phase: 'turnaround', fromSeconds: 0, toSeconds: 900 });
  });
});
