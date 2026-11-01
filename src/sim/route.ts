import { hypot } from '../domain/public/det-math';
import { distance, type Vec2 } from '../domain/public/geometry';
import type { Area } from '../domain/public/ground';
import { cellAtIndex, cellIndex, type TerrainGrid } from '../domain/public/terrain';

const NEIGHBORS: readonly (readonly [number, number, number])[] = [
  [0, -1, 1],
  [-1, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [-1, -1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, 1, Math.SQRT2],
];

// Binary heap ordered by (priority, cell index), so ties resolve identically every run.
class Frontier {
  private readonly cells: number[] = [];
  private readonly priorities: number[] = [];

  get size(): number {
    return this.cells.length;
  }

  private before(a: number, b: number): boolean {
    const pa = this.priorities[a] as number;
    const pb = this.priorities[b] as number;
    return pa !== pb ? pa < pb : (this.cells[a] as number) < (this.cells[b] as number);
  }

  private swap(a: number, b: number): void {
    [this.cells[a], this.cells[b]] = [this.cells[b] as number, this.cells[a] as number];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b] as number, this.priorities[a] as number];
  }

  push(cell: number, priority: number): void {
    this.cells.push(cell);
    this.priorities.push(priority);
    let i = this.cells.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.cells[0] as number;
    const last = this.cells.length - 1;
    this.swap(0, last);
    this.cells.pop();
    this.priorities.pop();
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let best = i;
      if (left < last && this.before(left, best)) best = left;
      if (right < last && this.before(right, best)) best = right;
      if (best === i) return top;
      this.swap(i, best);
      i = best;
    }
  }
}

const ROUTE_CACHE_LIMIT = 20000;
const AVOID_COST_FACTOR = 12;

function insideArea(grid: TerrainGrid, cell: number, { center, radius }: Area): boolean {
  const x = (cell % grid.width + 0.5) * grid.cellSize - center.x;
  const y = (Math.floor(cell / grid.width) + 0.5) * grid.cellSize - center.y;
  return x * x + y * y <= radius * radius;
}

const routeCaches = new WeakMap<TerrainGrid, Map<number, readonly Vec2[]>>();

/**
 * A* over terrain cells. The returned waypoints exclude the start and end at `to`.
 * Routes depend only on the two cells, so squads and repeat runs can share them.
 */
export function findRoute(grid: TerrainGrid, from: Vec2, to: Vec2, avoid: Area | null = null): Vec2[] {
  const start = cellIndex(grid, from);
  const goal = cellIndex(grid, to);
  if (start === goal) return [to];
  if (avoid !== null) return searchRoute(grid, start, goal, to, avoid);
  const cache = routeCaches.get(grid) ?? new Map<number, readonly Vec2[]>();
  routeCaches.set(grid, cache);
  const key = start * grid.width * grid.height + goal;
  const cached = cache.get(key);
  if (cached !== undefined) return [...cached.slice(0, -1), to];
  const route = searchRoute(grid, start, goal, to, null);
  if (cache.size >= ROUTE_CACHE_LIMIT) cache.clear();
  cache.set(key, route);
  return [...route];
}

/** Length of the route between two points, for comparing ways round. */
export function routeLength(grid: TerrainGrid, from: Vec2, to: Vec2, avoid: Area | null): number {
  let total = 0;
  let previous = from;
  for (const point of findRoute(grid, from, to, avoid)) {
    total += distance(previous, point);
    previous = point;
  }
  return total;
}

function searchRoute(grid: TerrainGrid, start: number, goal: number, to: Vec2, avoid: Area | null): Vec2[] {

  const { width, height, cellSize } = grid;
  const costs = new Float64Array(width * height).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(width * height).fill(-1);
  const goalColumn = goal % width;
  const goalRow = Math.floor(goal / width);
  const frontier = new Frontier();
  costs[start] = 0;
  frontier.push(start, 0);

  while (frontier.size > 0) {
    const current = frontier.pop();
    if (current === goal) break;
    const column = current % width;
    const row = Math.floor(current / width);
    const currentCost = costs[current] as number;
    for (const [dx, dy, stepLength] of NEIGHBORS) {
      const nextColumn = column + dx;
      const nextRow = row + dy;
      if (nextColumn < 0 || nextRow < 0 || nextColumn >= width || nextRow >= height) continue;
      const next = nextRow * width + nextColumn;
      const avoided = avoid !== null && insideArea(grid, next, avoid);
      const cost = currentCost + stepLength * cellAtIndex(grid, next).moveCost * (avoided ? AVOID_COST_FACTOR : 1);
      if (cost >= (costs[next] as number)) continue;
      costs[next] = cost;
      cameFrom[next] = current;
      frontier.push(next, cost + hypot(goalColumn - nextColumn, goalRow - nextRow));
    }
  }

  const cells: number[] = [];
  for (let cell = goal; cell !== start && cell >= 0; cell = cameFrom[cell] as number) {
    cells.push(cell);
  }
  const route = cells.reverse().map((cell) => ({
    x: (cell % width + 0.5) * cellSize,
    y: (Math.floor(cell / width) + 0.5) * cellSize,
  }));
  route[route.length - 1] = to;
  return route;
}
