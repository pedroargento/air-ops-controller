import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

async function ruleIds(code: string, filePath: string): Promise<readonly (string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.map((message) => message.ruleId) ?? [];
}

const IMPORT = 'no-restricted-imports';
const truthImport = "import type { WorldTruth } from '../domain/truth/world';\nexport type T = WorldTruth;\n";

describe('import boundaries', () => {
  it.each(['src/ai/x.ts', 'src/knowledge/x.ts', 'src/ui/x.ts', 'src/policies/x.ts'])(
    'blocks truth imports from %s',
    async (file) => {
      expect(await ruleIds(truthImport, file)).toContain(IMPORT);
    },
  );

  it.each(['src/sim/x.ts', 'src/perception/x.ts'])('allows truth imports from %s', async (file) => {
    expect(await ruleIds(truthImport, file)).not.toContain(IMPORT);
  });

  it('blocks ui from reaching knowledge internals but allows PlayerView', async () => {
    const internal = "import { x } from '../knowledge/track-store';\nexport const y = x;\n";
    const view = "import { x } from '../knowledge/player-view';\nexport const y = x;\n";
    expect(await ruleIds(internal, 'src/ui/x.ts')).toContain(IMPORT);
    expect(await ruleIds(view, 'src/ui/x.ts')).not.toContain(IMPORT);
  });

  it('blocks ui from reaching the game session, which holds truth', async () => {
    const code = "import { GameSession } from '../game/session';\nexport const s = GameSession;\n";
    expect(await ruleIds(code, 'src/ui/x.ts')).toContain(IMPORT);
  });

  it('blocks ai from importing sim', async () => {
    const code = "import { step } from '../sim/step';\nexport const s = step;\n";
    expect(await ruleIds(code, 'src/ai/x.ts')).toContain(IMPORT);
  });
});

describe('browser safety', () => {
  it.each(["'node:fs'", "'../cli/batch'", "'../cli/load-scenario'"])('blocks %s from debug code', async (source) => {
    expect(await ruleIds(`import { x } from ${source};\nexport const y = x;\n`, 'src/debug/x.ts')).toContain(IMPORT);
  });
});

describe('nondeterminism bans', () => {
  const RULE = 'no-restricted-properties';

  it.each(['Math.random()', 'Date.now()', 'performance.now()', 'Math.log(2)', 'Math.cos(1)', 'Math.hypot(1, 2)'])(
    'blocks %s in simulation code',
    async (call) => {
      expect(await ruleIds(`export const v = ${call};\n`, 'src/sim/x.ts')).toContain(RULE);
    },
  );

  it('permits the clock in ui code', async () => {
    expect(await ruleIds('export const v = performance.now();\n', 'src/ui/x.ts')).not.toContain(RULE);
  });
});
