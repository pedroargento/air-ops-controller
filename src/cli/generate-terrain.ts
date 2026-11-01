// Writes a scenario's ASCII terrain layers from its recipe.
// Usage: npx tsx src/cli/generate-terrain.ts [scenario name, or all of them]
import { mkdirSync, writeFileSync } from 'node:fs';
import { TERRAIN_RECIPES, buildLayers } from './terrain-recipes';

const requested = process.argv[2];
const names = requested === undefined ? Object.keys(TERRAIN_RECIPES) : [requested];

for (const name of names) {
  const recipe = TERRAIN_RECIPES[name];
  if (recipe === undefined) throw new Error(`No terrain recipe "${name}". Available: ${Object.keys(TERRAIN_RECIPES).join(', ')}`);
  const directory = `scenarios/${name}`;
  const { classLayer, elevationLayer } = buildLayers(recipe);
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/terrain.txt`, classLayer);
  writeFileSync(`${directory}/elevation.txt`, elevationLayer);
}
