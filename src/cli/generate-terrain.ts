// Writes the ASCII terrain layers for Outpost Under Pressure.
// Usage: npx tsx src/cli/generate-terrain.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRng, nextFloat, type RngState } from '../rng/streams';

const SIZE = 100;
const OUTPOST = { x: 50, y: 52 };
const OUT_DIR = 'scenarios/outpost-under-pressure';

// Sum of a few low-frequency sine waves, giving patchy vegetation without a noise library.
function waveField(rng: RngState): (x: number, y: number) => number {
  const waves = Array.from({ length: 6 }, () => ({
    fx: 0.03 + nextFloat(rng, 'field') * 0.12,
    fy: 0.03 + nextFloat(rng, 'field') * 0.12,
    phase: nextFloat(rng, 'field') * Math.PI * 2,
  }));
  return (x, y) =>
    waves.reduce((sum, w) => sum + Math.sin(x * w.fx + y * w.fy + w.phase), 0) / waves.length;
}

function elevationDigit(x: number, y: number, ridge: (x: number, y: number) => number): number {
  const hill = 5 * Math.exp(-((x - OUTPOST.x) ** 2 + (y - OUTPOST.y) ** 2) / 300);
  const northRidge = 4 * Math.exp(-((y - 14 - x * 0.1) ** 2) / 60);
  const rolling = 1.5 * (ridge(x, y) + 1);
  return Math.max(0, Math.min(9, Math.round(1 + hill + northRidge + rolling)));
}

function terrainSymbol(x: number, y: number, vegetation: (x: number, y: number) => number): string {
  const fromOutpost = Math.hypot(x - OUTPOST.x, y - OUTPOST.y);
  if (fromOutpost <= 2.5) return 'o';
  const onRoad = y > OUTPOST.y && Math.abs(x - (OUTPOST.x - (y - OUTPOST.y) * 0.45)) <= 0.8;
  if (onRoad) return 'r';
  if (fromOutpost <= 7) return '.';
  const stream = 20 + 60 * (x / SIZE) + 8 * Math.sin(x * 0.12);
  if (Math.abs(y - stream) <= 0.7) return 'w';
  const v = vegetation(x, y);
  if (v > 0.12) return 'j';
  return v > -0.25 ? 'f' : '.';
}

function buildLayer(cell: (x: number, y: number) => string): string {
  const rows: string[] = [];
  for (let y = 0; y < SIZE; y += 1) {
    let row = '';
    for (let x = 0; x < SIZE; x += 1) row += cell(x, y);
    rows.push(row);
  }
  return `${rows.join('\n')}\n`;
}

const rng = createRng(1965);
const vegetation = waveField(rng);
const ridge = waveField(rng);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/terrain.txt`, buildLayer((x, y) => terrainSymbol(x, y, vegetation)));
writeFileSync(`${OUT_DIR}/elevation.txt`, buildLayer((x, y) => String(elevationDigit(x, y, ridge))));
