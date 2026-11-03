import type { TerrainGrid } from '../domain/public/terrain';

const LIGHT_STRENGTH = 0.0075;
const SHADE_LIMIT = 0.22;
const SMOOTHING_CELLS = 2;

function heightAt(grid: TerrainGrid, column: number, row: number): number {
  const x = Math.max(0, Math.min(grid.width - 1, column));
  const y = Math.max(0, Math.min(grid.height - 1, row));
  return grid.elevation[y * grid.width + x] ?? 0;
}

/** Heights come in 10 m steps, so slopes are measured on an average to avoid terracing. */
function smoothHeight(grid: TerrainGrid, column: number, row: number): number {
  let total = 0;
  let cells = 0;
  for (let y = -SMOOTHING_CELLS; y <= SMOOTHING_CELLS; y += 1) {
    for (let x = -SMOOTHING_CELLS; x <= SMOOTHING_CELLS; x += 1) {
      total += heightAt(grid, column + x, row + y);
      cells += 1;
    }
  }
  return total / cells;
}

/** Brightness multiplier for a cell, lit from the northwest as maps conventionally are. */
export function hillshade(grid: TerrainGrid, column: number, row: number): number {
  const eastDrop = smoothHeight(grid, column - 1, row) - smoothHeight(grid, column + 1, row);
  const southDrop = smoothHeight(grid, column, row - 1) - smoothHeight(grid, column, row + 1);
  const slope = -(eastDrop + southDrop) * LIGHT_STRENGTH;
  return 1 + Math.max(-SHADE_LIMIT, Math.min(SHADE_LIMIT, slope));
}
