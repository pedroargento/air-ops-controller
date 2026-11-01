import { createRng, nextFloat, type RngState } from '../rng/streams';

type Field = (x: number, y: number) => number;

export type TerrainRecipe = Readonly<{
  size: number;
  seed: number;
  /** Elevation digit at a cell, given a rolling-ground field. */
  elevation: (x: number, y: number, rolling: Field) => number;
  /** Terrain symbol at a cell, given a vegetation field. */
  symbol: (x: number, y: number, vegetation: Field) => string;
}>;

// Sum of a few low-frequency sine waves, giving patchy vegetation without a noise library.
function waveField(rng: RngState): Field {
  const waves = Array.from({ length: 6 }, () => ({
    fx: 0.03 + nextFloat(rng, 'field') * 0.12,
    fy: 0.03 + nextFloat(rng, 'field') * 0.12,
    phase: nextFloat(rng, 'field') * Math.PI * 2,
  }));
  return (x, y) =>
    waves.reduce((sum, w) => sum + Math.sin(x * w.fx + y * w.fy + w.phase), 0) / waves.length;
}

function buildLayer(size: number, cell: (x: number, y: number) => string): string {
  const rows: string[] = [];
  for (let y = 0; y < size; y += 1) {
    let row = '';
    for (let x = 0; x < size; x += 1) row += cell(x, y);
    rows.push(row);
  }
  return `${rows.join('\n')}\n`;
}

export function buildLayers(recipe: TerrainRecipe): Readonly<{ classLayer: string; elevationLayer: string }> {
  const rng = createRng(recipe.seed);
  const vegetation = waveField(rng);
  const rolling = waveField(rng);
  return {
    classLayer: buildLayer(recipe.size, (x, y) => recipe.symbol(x, y, vegetation)),
    elevationLayer: buildLayer(recipe.size, (x, y) => String(recipe.elevation(x, y, rolling))),
  };
}

const digit = (value: number): number => Math.max(0, Math.min(9, Math.round(value)));

const OUTPOST = { x: 50, y: 52 };

const outpostUnderPressure: TerrainRecipe = {
  size: 100,
  seed: 1965,
  elevation: (x, y, rolling) => {
    const hill = 5 * Math.exp(-((x - OUTPOST.x) ** 2 + (y - OUTPOST.y) ** 2) / 300);
    const northRidge = 4 * Math.exp(-((y - 14 - x * 0.1) ** 2) / 60);
    return digit(1 + hill + northRidge + 1.5 * (rolling(x, y) + 1));
  },
  symbol: (x, y, vegetation) => {
    const fromOutpost = Math.hypot(x - OUTPOST.x, y - OUTPOST.y);
    if (fromOutpost <= 2.5) return 'o';
    const onRoad = y > OUTPOST.y && Math.abs(x - (OUTPOST.x - (y - OUTPOST.y) * 0.45)) <= 0.8;
    if (onRoad) return 'r';
    if (fromOutpost <= 7) return '.';
    const stream = 20 + 60 * (x / 100) + 8 * Math.sin(x * 0.12);
    if (Math.abs(y - stream) <= 0.7) return 'w';
    const v = vegetation(x, y);
    if (v > 0.12) return 'j';
    return v > -0.25 ? 'f' : '.';
  },
};

/** The road's column at a row: it winds up the valley floor. */
const valleyRoadX = (y: number): number => 40 + 6 * Math.sin(y * 0.09);

const valleyRoad: TerrainRecipe = {
  size: 80,
  seed: 1966,
  elevation: (x, y, rolling) => {
    const fromRoad = Math.abs(x - valleyRoadX(y));
    return digit(1 + (fromRoad / 40) ** 2 * 8 + (rolling(x, y) + 1) * Math.min(1, fromRoad / 10));
  },
  symbol: (x, y, vegetation) => {
    const fromRoad = Math.abs(x - valleyRoadX(y));
    if (fromRoad <= 0.8) return 'r';
    if (fromRoad <= 3) return '.';
    const v = vegetation(x, y);
    if (v > 0.05) return 'j';
    return v > -0.3 ? 'f' : '.';
  },
};

export const TERRAIN_RECIPES: Readonly<Record<string, TerrainRecipe>> = {
  'outpost-under-pressure': outpostUnderPressure,
  'valley-road': valleyRoad,
};
