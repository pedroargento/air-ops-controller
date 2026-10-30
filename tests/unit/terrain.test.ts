import { describe, expect, it } from 'vitest';
import { cellAt, hasGroundLos, type TerrainCell } from '../../src/domain/public/terrain';
import { parseTerrain } from '../../src/scenario/load';
import { findRoute } from '../../src/sim/route';

const cell = (name: string, moveCost: number, groundObstruction: number): TerrainCell => ({
  terrainClass: name,
  moveCost,
  groundCover: 0,
  airCover: 0,
  groundConcealment: 0,
  airConcealment: 0,
  groundObstruction,
  airObstruction: 0,
});

const legend = { '.': cell('open', 1, 0), j: cell('jungle', 10, 0.6) };
const config = { cellSizeMeters: 50, elevationStepMeters: 10, legend, classLayer: '', elevationLayer: '' };

const grid = (classes: readonly string[], elevation?: readonly string[]) =>
  parseTerrain(
    config,
    classes.join('\n'),
    (elevation ?? classes.map((row) => '0'.repeat(row.length))).join('\n'),
  );

describe('terrain parsing', () => {
  it('maps symbols and elevation into cells', () => {
    const terrain = grid(['.j'], ['05']);
    expect(cellAt(terrain, { x: 75, y: 25 }).terrainClass).toBe('jungle');
    expect(terrain.elevation[1]).toBe(50);
  });

  it('rejects unknown symbols and mismatched layers', () => {
    expect(() => grid(['.?'])).toThrow(/Unknown terrain symbol/);
    expect(() => grid(['..'], ['000'])).toThrow(/differ in size/);
    expect(() => grid(['..', '.'])).toThrow(/has width/);
  });
});

describe('line of sight', () => {
  const from = { x: 25, y: 25 };
  const to = { x: 275, y: 25 };

  it('is clear over open ground', () => {
    expect(hasGroundLos(grid(['......']), from, to)).toBe(true);
  });

  it('is blocked by accumulated vegetation', () => {
    expect(hasGroundLos(grid(['.jj...']), from, to)).toBe(false);
    expect(hasGroundLos(grid(['..j...']), from, to)).toBe(true);
  });

  it('is blocked by rising ground', () => {
    expect(hasGroundLos(grid(['......'], ['002000']), from, to)).toBe(false);
  });
});

describe('routing', () => {
  const terrain = grid(['.....', '.jjj.', '.....']);
  const start = { x: 25, y: 75 };
  const end = { x: 225, y: 75 };

  it('goes around expensive terrain and ends at the destination', () => {
    const route = findRoute(terrain, start, end);
    expect(route.at(-1)).toEqual(end);
    expect(route.slice(0, -1).every((p) => cellAt(terrain, p).terrainClass === 'open')).toBe(true);
  });

  it('is identical between runs', () => {
    expect(findRoute(terrain, start, end)).toEqual(findRoute(terrain, start, end));
  });
});
