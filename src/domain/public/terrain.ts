import { hypot } from './det-math';
import type { Vec2 } from './geometry';

// Terrain is public knowledge: the player and every unit can read the map.
export type TerrainCell = Readonly<{
  terrainClass: string;
  moveCost: number;
  groundCover: number;
  airCover: number;
  groundConcealment: number;
  airConcealment: number;
  groundObstruction: number;
  airObstruction: number;
}>;

export type TerrainGrid = Readonly<{
  width: number;
  height: number;
  cellSize: number;
  classes: readonly TerrainCell[];
  classIndex: Uint8Array;
  elevation: Float32Array;
}>;

export function cellIndex(grid: TerrainGrid, position: Vec2): number {
  const column = Math.max(0, Math.min(grid.width - 1, Math.floor(position.x / grid.cellSize)));
  const row = Math.max(0, Math.min(grid.height - 1, Math.floor(position.y / grid.cellSize)));
  return row * grid.width + column;
}

export function cellAtIndex(grid: TerrainGrid, index: number): TerrainCell {
  const cell = grid.classes[grid.classIndex[index] ?? 0];
  if (cell === undefined) throw new Error(`No terrain class at cell ${index}`);
  return cell;
}

export function cellAt(grid: TerrainGrid, position: Vec2): TerrainCell {
  return cellAtIndex(grid, cellIndex(grid, position));
}

export function elevationAt(grid: TerrainGrid, position: Vec2): number {
  return grid.elevation[cellIndex(grid, position)] ?? 0;
}

const EYE_HEIGHT_METERS = 2;

/**
 * Whether terrain lets a ground position and something in the air see each other, in both
 * directions. Vegetation is left out: `airConcealment` and `airObstruction` cover it.
 */
export function hasAirLos(grid: TerrainGrid, ground: Vec2, air: Vec2, altitudeMeters: number): boolean {
  const gap = hypot(air.x - ground.x, air.y - ground.y);
  const samples = Math.floor(gap / grid.cellSize);
  const start = elevationAt(grid, ground) + EYE_HEIGHT_METERS;
  for (let i = 1; i < samples; i += 1) {
    const t = i / samples;
    const point = { x: ground.x + (air.x - ground.x) * t, y: ground.y + (air.y - ground.y) * t };
    if (elevationAt(grid, point) > start + (altitudeMeters - start) * t) return false;
  }
  return true;
}

/**
 * Samples the cells between two points. Line of sight fails when terrain rises
 * above the sight line or when accumulated vegetation obstruction reaches 1.
 */
export function hasGroundLos(grid: TerrainGrid, from: Vec2, to: Vec2): boolean {
  const gap = hypot(to.x - from.x, to.y - from.y);
  const samples = Math.floor(gap / grid.cellSize);
  const fromHeight = elevationAt(grid, from) + EYE_HEIGHT_METERS;
  const toHeight = elevationAt(grid, to) + EYE_HEIGHT_METERS;
  let obstruction = 0;
  for (let i = 1; i < samples; i += 1) {
    const t = i / samples;
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    const sightHeight = fromHeight + (toHeight - fromHeight) * t;
    if (elevationAt(grid, point) > sightHeight) return false;
    obstruction += cellAt(grid, point).groundObstruction;
    if (obstruction >= 1) return false;
  }
  return true;
}
