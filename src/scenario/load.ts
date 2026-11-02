import type { Doctrine } from '../domain/public/ground';
import { AIR_OPS } from '../domain/public/radio';
import type { TerrainCell, TerrainGrid } from '../domain/public/terrain';
import { scenarioFileSchema, type ScenarioFile } from './schema';

export type Scenario = Readonly<{
  file: ScenarioFile;
  terrain: TerrainGrid;
  doctrines: Readonly<Record<string, Doctrine>>;
}>;

function layerRows(text: string, label: string): readonly string[] {
  const rows = text.split('\n').filter((row) => row.length > 0);
  const width = rows[0]?.length ?? 0;
  if (width === 0) throw new Error(`Terrain layer ${label} is empty`);
  for (const [index, row] of rows.entries()) {
    if (row.length !== width) {
      throw new Error(`Terrain layer ${label} row ${index} has width ${row.length}, expected ${width}`);
    }
  }
  return rows;
}

export function parseTerrain(
  file: ScenarioFile['terrain'],
  classText: string,
  elevationText: string,
): TerrainGrid {
  const classRows = layerRows(classText, 'class');
  const elevationRows = layerRows(elevationText, 'elevation');
  const height = classRows.length;
  const width = classRows[0]?.length ?? 0;
  if (elevationRows.length !== height || elevationRows[0]?.length !== width) {
    throw new Error('Terrain class and elevation layers differ in size');
  }

  const symbols = Object.keys(file.legend).sort();
  const classes: TerrainCell[] = symbols.map((symbol) => file.legend[symbol] as TerrainCell);
  const classIndex = new Uint8Array(width * height);
  const elevation = new Float32Array(width * height);

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const symbol = classRows[row]?.[column] ?? '';
      const index = symbols.indexOf(symbol);
      if (index < 0) throw new Error(`Unknown terrain symbol "${symbol}" at ${column},${row}`);
      const digit = Number.parseInt(elevationRows[row]?.[column] ?? '', 36);
      if (Number.isNaN(digit)) throw new Error(`Bad elevation digit at ${column},${row}`);
      classIndex[row * width + column] = index;
      elevation[row * width + column] = digit * file.elevationStepMeters;
    }
  }

  return { width, height, cellSize: file.cellSizeMeters, classes, classIndex, elevation };
}

// Air operations links only to friendly units, so no enemy message can ever reach the player.
function validateLinks(file: ScenarioFile): void {
  const sideOf = new Map<string, string>(file.units.map((unit) => [unit.id, unit.side]));
  sideOf.set(AIR_OPS, 'friendly');
  for (const [a, b] of file.links) {
    const sideA = sideOf.get(a);
    const sideB = sideOf.get(b);
    if (sideA === undefined || sideB === undefined) {
      throw new Error(`Link ${a}-${b} references an unknown node`);
    }
    if (sideA !== sideB) throw new Error(`Link ${a}-${b} crosses sides`);
  }
}

function validateMission({ mission, units }: ScenarioFile): void {
  if (mission.kind !== 'ReachArea') return;
  for (const id of mission.unitIds) {
    const unit = units.find((candidate) => candidate.id === id);
    if (unit === undefined) throw new Error(`Mission references unknown unit ${id}`);
    if (unit.side !== 'friendly') throw new Error(`Mission unit ${id} is not friendly`);
  }
}

/** Pure: callers supply the file contents, so this works in Node and the browser. */
export function loadScenario(raw: unknown, classText: string, elevationText: string): Scenario {
  const file = scenarioFileSchema.parse(raw);
  for (const unit of file.units) {
    if (file.doctrines[unit.doctrine] === undefined) {
      throw new Error(`Unit ${unit.id} references unknown doctrine ${unit.doctrine}`);
    }
  }
  const ids = new Set(file.units.map((unit) => unit.id));
  if (ids.size !== file.units.length) throw new Error('Duplicate unit IDs in scenario');
  validateLinks(file);
  validateMission(file);
  return {
    file,
    terrain: parseTerrain(file.terrain, classText, elevationText),
    doctrines: file.doctrines,
  };
}
