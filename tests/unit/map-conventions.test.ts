import { describe, expect, it } from 'vitest';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import type { ContactId } from '../../src/domain/public/ground';
import type { TerrainGrid } from '../../src/domain/public/terrain';
import {
  admiraltyRating,
  contactCondition,
  echelonOf,
  estimatedEchelon,
  friendlyCondition,
  maxElevationFigures,
  spotHeights,
} from '../../src/ui/map-conventions';
import { lineSegments, smoothLine, traceLines } from '../../src/ui/topo';

function grid(width: number, height: number, height_: (column: number, row: number) => number): TerrainGrid {
  const elevation = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) elevation[row * width + column] = height_(column, row);
  return { width, height, cellSize: 50, classes: [], classIndex: new Uint8Array(0), elevation };
}

const contact = (overrides: Partial<ContactEstimate> = {}): ContactEstimate => ({
  contactId: 'C-1' as ContactId,
  provenance: { sourceId: 'CAS-1', observedAt: 0 },
  identification: 'hostile',
  position: { center: { x: 0, y: 0 }, sigmaMeters: 30, headingRad: null, speedMps: null, observedAt: 0 },
  strength: { kind: 'range', min: 6, max: 14 },
  kind: 'infantry',
  activity: 'stationary',
  confidence: 'medium',
  observedWeapons: [],
  ...overrides,
});

describe('unit size marks', () => {
  it('reads the size from a head count', () => {
    expect(echelonOf(4)).toBe('team');
    expect(echelonOf(9)).toBe('squad');
    expect(echelonOf(24)).toBe('platoon');
    expect(echelonOf(120)).toBe('company');
  });

  it('takes an estimate at the largest it could be, and leaves unknown strength unmarked', () => {
    expect(estimatedEchelon({ kind: 'range', min: 15, max: 50 })).toBe('platoon');
    expect(estimatedEchelon({ kind: 'unknown' })).toBeNull();
  });
});

describe('condition', () => {
  it('shows no bar until losses are claimed', () => {
    expect(contactCondition(0, { kind: 'range', min: 6, max: 14 })).toBeNull();
    expect(friendlyCondition(24, 24)).toBeNull();
  });

  it('weighs claims against claims plus what is still thought to be there', () => {
    const light = contactCondition(2, { kind: 'range', min: 6, max: 14 });
    expect(light?.condition).toBe('neutralized');
    expect(contactCondition(1, { kind: 'range', min: 15, max: 50 })?.condition).toBe('capable');
    const heavy = contactCondition(10, { kind: 'range', min: 1, max: 5 });
    expect(heavy?.condition).toBe('combatIneffective');
    expect(heavy?.probablyDestroyed).toBe(false);
    expect(contactCondition(40, { kind: 'range', min: 1, max: 5 })?.probablyDestroyed).toBe(true);
  });

  it('reads a friendly unit from its own report', () => {
    expect(friendlyCondition(22, 24)?.condition).toBe('capable');
    expect(friendlyCondition(20, 24)?.condition).toBe('neutralized');
    expect(friendlyCondition(14, 24)?.condition).toBe('combatIneffective');
  });
});

describe('Admiralty rating', () => {
  it('rates aircraft above ground reports, and confidence as credibility', () => {
    expect(admiraltyRating({ viaAircraft: true, contact: contact({ confidence: 'high' }), members: [] })).toBe('B2');
    expect(admiraltyRating({ viaAircraft: false, contact: contact({ confidence: 'low' }), members: [] })).toBe('C4');
  });

  it('counts a report confirmed by another source as the most credible', () => {
    const other = { contact: contact({ provenance: { sourceId: 'F-A', observedAt: 0 } }) } as never;
    expect(admiraltyRating({ viaAircraft: true, contact: contact(), members: [other] })).toBe('B1');
    const same = { contact: contact() } as never;
    expect(admiraltyRating({ viaAircraft: true, contact: contact(), members: [same] })).toBe('B3');
  });
});

describe('chart figures', () => {
  it('marks a summit once, not its flat top or a low bump', () => {
    const hill = grid(20, 20, (c, r) => Math.max(40, 200 - 15 * Math.max(Math.abs(c - 10), Math.abs(r - 10))));
    const peaks = spotHeights(hill);
    expect(peaks).toHaveLength(1);
    expect(peaks[0]?.meters).toBe(200);
    expect(spotHeights(grid(20, 20, (c) => 100 + (c === 5 ? 20 : 0)))).toHaveLength(0);
  });

  it('gives each square its highest ground, rounded up', () => {
    const slope = grid(40, 20, (c) => 40 + c * 3);
    const figures = maxElevationFigures(slope, 1000);
    expect(figures).toHaveLength(2);
    expect(figures[0]?.meters).toBe(100);
    expect(figures[1]?.meters).toBe(160);
    expect(figures[1]?.origin).toEqual({ x: 1000, y: 0 });
  });
});

describe('roads and streams as lines', () => {
  it('cuts the corners of a staircase into a straight diagonal', () => {
    // A road stepping down and right: (0,0) (1,0) (1,1) (2,1) (2,2)
    const cells = new Set(['0,0', '1,0', '1,1', '2,1', '2,2']);
    const segments = lineSegments(3, 3, (c, r) => cells.has(`${c},${r}`));
    expect(segments.every(([x0, y0, x1, y1]) => Math.abs(x1 - x0) + Math.abs(y1 - y0) <= 2)).toBe(true);
    expect(segments.some(([x0, y0, x1, y1]) => Math.abs(x1 - x0) === 1 && Math.abs(y1 - y0) === 1)).toBe(true);
    expect(segments.length).toBeLessThan(4);
  });

  it('keeps a straight run and a junction as they are', () => {
    const row = lineSegments(4, 1, () => true);
    expect(row).toEqual([[0, 0, 1, 0], [1, 0, 2, 0], [2, 0, 3, 0]]);
    // A side road two cells long stays; a one-cell stub off a road is drawn as part of it.
    const junction = new Set(['0,2', '1,2', '2,2', '3,2', '4,2', '2,1', '2,0']);
    expect(lineSegments(5, 3, (c, r) => junction.has(`${c},${r}`))).toHaveLength(6);
    const stub = new Set(['0,1', '1,1', '2,1', '1,0']);
    expect(lineSegments(3, 2, (c, r) => stub.has(`${c},${r}`))).toHaveLength(2);
  });
});

describe('drawing lines smoothly', () => {
  it('joins a run of segments into one line and breaks at a junction', () => {
    expect(traceLines([[0, 0, 1, 0], [1, 0, 2, 0], [2, 0, 3, 0]])).toHaveLength(1);
    const tee = traceLines([[0, 1, 1, 1], [1, 1, 2, 1], [1, 0, 1, 1]]);
    expect(tee).toHaveLength(3);
    expect(tee.flat().length).toBe(6);
  });

  it('rounds corners but keeps the ends where they were', () => {
    const corner = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }];
    const smooth = smoothLine(corner);
    expect(smooth[0]).toEqual(corner[0]);
    expect(smooth.at(-1)).toEqual(corner[2]);
    expect(smooth.some((point) => point.x === 2 && point.y === 0)).toBe(false);
  });
});
