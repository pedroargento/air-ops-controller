import { cellAtIndex, type TerrainGrid } from '../domain/public/terrain';
import { CONTOUR_INTERVAL_METERS, INDEX_CONTOUR_METERS } from './map-conventions';
import { hillshade } from './terrain-shading';
import { contourSegments } from './weather-chart';

/*
 * The base map in the manner of a 1:50,000 topographic sheet. Each kind of information keeps
 * its own channel: land cover is color, relief is light and shade with brown contours, so
 * neither hides the other, and the weather layer can sit on top of both.
 */

const COVER_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  open: [240, 236, 220],
  forest: [190, 218, 166],
  jungle: [156, 199, 136],
  outpost: [196, 188, 178],
  road: [214, 120, 72],
  stream: [120, 178, 222],
};
const UNKNOWN_COVER: readonly [number, number, number] = [220, 220, 220];

export const TOPO_PIXELS_PER_CELL = 8;
const CONTOUR_COLOR = 'rgba(150,95,40,0.75)';
const INDEX_LABEL_SPACING_METERS = 1400;
/** Drawn as lines through the cells they cross, not as filled squares. */
const LINEAR: Readonly<Record<string, Readonly<{ color: string; casing: string | null; width: number }>>> = {
  road: { color: 'rgb(214,96,52)', casing: 'rgb(110,50,30)', width: 3.5 },
  stream: { color: 'rgb(70,140,205)', casing: null, width: 2.5 },
};

/** Elevation averaged over neighbours: heights come in 10 m steps, which would terrace the contours. */
function smoothedElevation(grid: TerrainGrid): Float64Array {
  const field = new Float64Array(grid.width * grid.height);
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      let total = 0;
      let cells = 0;
      for (let y = Math.max(0, row - 1); y <= Math.min(grid.height - 1, row + 1); y += 1) {
        for (let x = Math.max(0, column - 1); x <= Math.min(grid.width - 1, column + 1); x += 1) {
          total += grid.elevation[y * grid.width + x] ?? 0;
          cells += 1;
        }
      }
      field[row * grid.width + column] = total / cells;
    }
  }
  return field;
}

/** The area color a cell shows: a road or stream cell shows the ground around it, and the line goes on top. */
function areaColors(grid: TerrainGrid): readonly (readonly [number, number, number])[] {
  const own = (index: number): string => cellAtIndex(grid, index).terrainClass;
  return Array.from({ length: grid.width * grid.height }, (_, index) => {
    const terrainClass = own(index);
    if (LINEAR[terrainClass] === undefined) return COVER_COLORS[terrainClass] ?? UNKNOWN_COVER;
    const [column, row] = [index % grid.width, Math.floor(index / grid.width)];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
      const [x, y] = [column + dx, row + dy];
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
      const neighbour = own(y * grid.width + x);
      if (LINEAR[neighbour] === undefined) return COVER_COLORS[neighbour] ?? UNKNOWN_COVER;
    }
    return COVER_COLORS['open'] ?? UNKNOWN_COVER;
  });
}

/** Sampled between cell centers, so woodland edges and slopes blend instead of stepping. */
function bilinear(values: (index: number) => number, grid: TerrainGrid, x: number, y: number): number {
  const column = Math.max(0, Math.min(grid.width - 1.001, x - 0.5));
  const row = Math.max(0, Math.min(grid.height - 1.001, y - 0.5));
  const [c0, r0] = [Math.floor(column), Math.floor(row)];
  const [c1, r1] = [Math.min(grid.width - 1, c0 + 1), Math.min(grid.height - 1, r0 + 1)];
  const [fx, fy] = [column - c0, row - r0];
  const at = (c: number, r: number): number => values(r * grid.width + c);
  return (at(c0, r0) * (1 - fx) + at(c1, r0) * fx) * (1 - fy) + (at(c0, r1) * (1 - fx) + at(c1, r1) * fx) * fy;
}

function paintCover(context: CanvasRenderingContext2D, grid: TerrainGrid): void {
  const scale = TOPO_PIXELS_PER_CELL;
  const shades = new Float64Array(grid.width * grid.height);
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) shades[row * grid.width + column] = hillshade(grid, column, row);
  }
  const colors = areaColors(grid);
  const channel = (k: 0 | 1 | 2) => (index: number): number => colors[index]?.[k] ?? 220;
  const [red, green, blue] = [channel(0), channel(1), channel(2)];
  const shade = (index: number): number => shades[index] ?? 1;
  const image = context.createImageData(grid.width * scale, grid.height * scale);
  for (let py = 0; py < image.height; py += 1) {
    for (let px = 0; px < image.width; px += 1) {
      const [x, y] = [(px + 0.5) / scale, (py + 0.5) / scale];
      // Relief shading is printed light, so it darkens toward grey without washing out colors.
      const light = bilinear(shade, grid, x, y);
      const factor = Math.min(1.03, Math.max(0.72, 1 + (light - 1) * 1.1));
      const offset = (py * image.width + px) * 4;
      image.data[offset] = Math.min(255, bilinear(red, grid, x, y) * factor);
      image.data[offset + 1] = Math.min(255, bilinear(green, grid, x, y) * factor);
      image.data[offset + 2] = Math.min(255, bilinear(blue, grid, x, y) * factor);
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

export type CellSegment = readonly [number, number, number, number];

/**
 * Lines joining the centers of neighbouring cells of one kind. A road drawn across square
 * cells turns corners at every step, so where a cell only links one horizontal and one
 * vertical neighbour that also touch diagonally, the corner is cut and the line runs straight.
 */
export function lineSegments(width: number, height: number, isPart: (column: number, row: number) => boolean): readonly CellSegment[] {
  const part = (column: number, row: number): boolean => column >= 0 && row >= 0 && column < width && row < height && isPart(column, row);
  const key = (column: number, row: number): number => row * width + column;
  const links = new Map<number, Set<number>>();
  const link = (a: number, b: number): void => {
    (links.get(a) ?? links.set(a, new Set()).get(a))?.add(b);
    (links.get(b) ?? links.set(b, new Set()).get(b))?.add(a);
  };
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (!part(column, row)) continue;
      if (part(column + 1, row)) link(key(column, row), key(column + 1, row));
      if (part(column, row + 1)) link(key(column, row), key(column, row + 1));
      // A diagonal only where no square corner already joins the two.
      if (part(column + 1, row + 1) && !part(column + 1, row) && !part(column, row + 1)) link(key(column, row), key(column + 1, row + 1));
      if (part(column - 1, row + 1) && !part(column - 1, row) && !part(column, row + 1)) link(key(column, row), key(column - 1, row + 1));
    }
  }
  for (const cell of [...links.keys()].sort((a, b) => a - b)) {
    const neighbours = [...(links.get(cell) ?? [])];
    if (neighbours.length !== 2) continue;
    const [a, b] = neighbours as [number, number];
    const [ax, ay, bx, by] = [a % width, Math.floor(a / width), b % width, Math.floor(b / width)];
    if (Math.abs(ax - bx) !== 1 || Math.abs(ay - by) !== 1) continue;
    links.get(a)?.delete(cell);
    links.get(b)?.delete(cell);
    links.delete(cell);
    link(a, b);
  }
  // Where a road is two cells wide its line forms little triangles and one-cell spurs. A
  // drafter draws one line: drop chords between junctions, then stubs off a junction.
  const degree = (cell: number): number => links.get(cell)?.size ?? 0;
  const unlink = (a: number, b: number): void => {
    links.get(a)?.delete(b);
    links.get(b)?.delete(a);
  };
  for (const [a, ends] of [...links.entries()].sort(([x], [y]) => x - y)) {
    for (const b of [...ends].sort((x, y) => x - y)) if (b > a && degree(a) >= 3 && degree(b) >= 3) unlink(a, b);
  }
  for (const [a, ends] of [...links.entries()].sort(([x], [y]) => x - y)) {
    for (const b of [...ends]) if (degree(a) === 1 && degree(b) >= 3) unlink(a, b);
  }
  const segments: CellSegment[] = [];
  for (const [a, ends] of [...links.entries()].sort(([x], [y]) => x - y)) {
    for (const b of [...ends].sort((x, y) => x - y)) {
      if (b > a) segments.push([a % width, Math.floor(a / width), b % width, Math.floor(b / width)]);
    }
  }
  return segments;
}

type Point = Readonly<{ x: number; y: number }>;

/**
 * Joins segments into continuous lines, breaking at ends and junctions, so each stretch of
 * road can be drawn as one smooth stroke.
 */
export function traceLines(segments: readonly CellSegment[]): readonly (readonly Point[])[] {
  const id = (x: number, y: number): string => `${x},${y}`;
  const ends = new Map<string, Point[]>();
  for (const [x0, y0, x1, y1] of segments) {
    (ends.get(id(x0, y0)) ?? ends.set(id(x0, y0), []).get(id(x0, y0)))?.push({ x: x1, y: y1 });
    (ends.get(id(x1, y1)) ?? ends.set(id(x1, y1), []).get(id(x1, y1)))?.push({ x: x0, y: y0 });
  }
  const used = new Set<string>();
  const edge = (a: Point, b: Point): string => [id(a.x, a.y), id(b.x, b.y)].sort().join('|');
  const lines: Point[][] = [];
  const walk = (start: Point, next: Point): void => {
    const line = [start, next];
    used.add(edge(start, next));
    let [previous, current] = [start, next];
    for (;;) {
      const onward = ends.get(id(current.x, current.y)) ?? [];
      if (onward.length !== 2) break;
      const following = onward.find((point) => !(point.x === previous.x && point.y === previous.y));
      if (following === undefined || used.has(edge(current, following))) break;
      used.add(edge(current, following));
      line.push(following);
      [previous, current] = [current, following];
    }
    lines.push(line);
  };
  const keys = [...ends.keys()].sort();
  // Start from ends and junctions first, then whatever loops are left.
  for (const pass of [true, false]) {
    for (const key of keys) {
      const neighbours = ends.get(key) ?? [];
      if (pass && neighbours.length === 2) continue;
      const [x, y] = key.split(',').map(Number) as [number, number];
      for (const neighbour of neighbours) if (!used.has(edge({ x, y }, neighbour))) walk({ x, y }, neighbour);
    }
  }
  return lines;
}

/** Chaikin's corner cutting: rounds a line the way a drafter would draw it, keeping its ends. */
export function smoothLine(line: readonly Point[], rounds = 2): readonly Point[] {
  let points = [...line];
  for (let round = 0; round < rounds && points.length > 2; round += 1) {
    const next: Point[] = [points[0] as Point];
    for (let index = 0; index + 1 < points.length; index += 1) {
      const [a, b] = [points[index] as Point, points[index + 1] as Point];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(points.at(-1) as Point);
    points = next;
  }
  return points;
}

/** Roads and streams as smooth lines through their cells, not as filled squares. */
function paintLinear(context: CanvasRenderingContext2D, grid: TerrainGrid): void {
  const scale = TOPO_PIXELS_PER_CELL;
  for (const [terrainClass, style] of Object.entries(LINEAR)) {
    const segments = lineSegments(grid.width, grid.height, (column, row) => cellAtIndex(grid, row * grid.width + column).terrainClass === terrainClass);
    const lines = traceLines(segments).map((line) => smoothLine(line, 3));
    const stroke = (color: string, width: number): void => {
      context.strokeStyle = color;
      context.lineWidth = width;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      for (const line of lines) {
        line.forEach((point, index) => {
          const [x, y] = [(point.x + 0.5) * scale, (point.y + 0.5) * scale];
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
      }
      context.stroke();
    };
    if (style.casing !== null) stroke(style.casing, style.width + 2);
    stroke(style.color, style.width);
  }
}

function paintContours(context: CanvasRenderingContext2D, grid: TerrainGrid): void {
  const field = smoothedElevation(grid);
  const values = Array.from(field);
  const low = Math.ceil(Math.min(...values) / CONTOUR_INTERVAL_METERS) * CONTOUR_INTERVAL_METERS;
  const high = Math.max(...values);
  // Samples sit at cell centers: the tracer measures from the first one, so shift by half a cell.
  const pixel = (meters: number): number => (meters / grid.cellSize + 0.5) * TOPO_PIXELS_PER_CELL;
  const labels: { x: number; y: number; text: string; angle: number }[] = [];
  for (let level = low; level <= high; level += CONTOUR_INTERVAL_METERS) {
    const index = level % INDEX_CONTOUR_METERS === 0;
    const segments = contourSegments({ columns: grid.width, rows: grid.height, stepMeters: grid.cellSize, ceilings: field }, level);
    context.strokeStyle = CONTOUR_COLOR;
    context.lineWidth = index ? 2 : 1;
    context.beginPath();
    for (const [a, b] of segments) {
      context.moveTo(pixel(a.x), pixel(a.y));
      context.lineTo(pixel(b.x), pixel(b.y));
    }
    context.stroke();
    if (!index) continue;
    const spacing = (INDEX_LABEL_SPACING_METERS / grid.cellSize) * TOPO_PIXELS_PER_CELL;
    for (const [a, b] of segments) {
      const x = (pixel(a.x) + pixel(b.x)) / 2;
      const y = (pixel(a.y) + pixel(b.y)) / 2;
      if (labels.some((label) => Math.hypot(label.x - x, label.y - y) < spacing)) continue;
      let angle = Math.atan2(pixel(b.y) - pixel(a.y), pixel(b.x) - pixel(a.x));
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      labels.push({ x, y, text: String(level), angle });
    }
  }
  for (const label of labels) {
    context.save();
    context.translate(label.x, label.y);
    context.rotate(label.angle);
    context.font = 'bold 13px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const width = context.measureText(label.text).width + 4;
    // Contour labels break the line they sit on, as printed maps do.
    context.globalCompositeOperation = 'destination-out';
    context.fillRect(-width / 2, -6, width, 12);
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = 'rgb(150,95,40)';
    context.fillText(label.text, 0, 0);
    context.restore();
  }
}

/** The terrain, painted once at a resolution that still looks drawn when zoomed in. */
export function paintTopo(grid: TerrainGrid): HTMLCanvasElement {
  const cover = document.createElement('canvas');
  cover.width = grid.width * TOPO_PIXELS_PER_CELL;
  cover.height = grid.height * TOPO_PIXELS_PER_CELL;
  const coverContext = cover.getContext('2d');
  if (coverContext === null) throw new Error('Canvas 2D is unavailable');
  paintCover(coverContext, grid);

  const lines = document.createElement('canvas');
  lines.width = cover.width;
  lines.height = cover.height;
  const linesContext = lines.getContext('2d');
  if (linesContext === null) throw new Error('Canvas 2D is unavailable');
  paintContours(linesContext, grid);
  coverContext.drawImage(lines, 0, 0);
  paintLinear(coverContext, grid);
  return cover;
}
