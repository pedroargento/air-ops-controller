import { describe, expect, it } from 'vitest';
import type { TerrainGrid } from '../../src/domain/public/terrain';
import { clipToMap, groundAlong } from '../../src/ui/path-profile';
import { hillshade } from '../../src/ui/terrain-shading';

function grid(rows: readonly (readonly number[])[]): TerrainGrid {
  return {
    width: rows[0]?.length ?? 0,
    height: rows.length,
    cellSize: 50,
    classes: [],
    classIndex: new Uint8Array(0),
    elevation: new Float32Array(rows.flat()),
  };
}

describe('terrain shading', () => {
  it('leaves flat ground alone', () => {
    expect(hillshade(grid([[20, 20, 20], [20, 20, 20], [20, 20, 20]]), 1, 1)).toBe(1);
  });

  it('lights slopes facing northwest and darkens those facing southeast', () => {
    const rising = grid([[10, 20, 30], [20, 30, 40], [30, 40, 50]]);
    const falling = grid([[50, 40, 30], [40, 30, 20], [30, 20, 10]]);
    expect(hillshade(rising, 1, 1)).toBeGreaterThan(1);
    expect(hillshade(falling, 1, 1)).toBeLessThan(1);
  });

  it('keeps a steep slope within limits', () => {
    const cliff = grid([[0, 0, 500], [0, 0, 500], [0, 0, 500]]);
    expect(hillshade(cliff, 1, 1)).toBeCloseTo(1.22);
  });

});

describe('path profile', () => {
  it('clips a long transit to the part over the map', () => {
    const clipped = clipToMap({ x: 2500, y: -25000 }, { x: 2500, y: 2500 }, 5000);
    expect(clipped?.start.x).toBe(2500);
    expect(clipped?.start.y).toBeGreaterThanOrEqual(0);
    expect(clipped?.start.y).toBeLessThan(100);
    expect(clipped?.end.y).toBe(2500);
  });

  it('has nothing to show for a path that never crosses the map', () => {
    expect(clipToMap({ x: -900, y: -900 }, { x: -100, y: -100 }, 5000)).toBeNull();
  });

  it('samples the ground along the path', () => {
    const terrain = grid([[10, 20, 30, 40]]);
    const points = groundAlong(terrain, { x: 0, y: 0 }, { x: 199, y: 0 });
    expect(points[0]?.ground).toBe(10);
    expect(points.at(-1)?.ground).toBe(40);
  });
});
