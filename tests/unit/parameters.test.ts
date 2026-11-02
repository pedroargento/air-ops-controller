import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parametersMarkdown } from '../../src/cli/parameters';
import { applySettings, settingsFromArgs } from '../../src/cli/settings';
import { loadScenarioFile } from '../../src/cli/load-scenario';

describe('rules parameters', () => {
  it('has the reference page up to date: run npm run params', () => {
    expect(readFileSync('docs/parameters.md', 'utf8')).toBe(parametersMarkdown());
  });

  it('describes every value', () => {
    const blank = parametersMarkdown()
      .split('\n')
      .filter((line) => line.startsWith('| `') && line.trimEnd().endsWith('|  |'));
    expect(blank).toEqual([]);
  });
});

describe('--set', () => {
  const scenario = loadScenarioFile();

  it('changes one value, read as JSON', () => {
    const changed = applySettings(scenario, ['combat.suppressionDecayPerUpdate=0.03']);
    expect(changed.file.combat.suppressionDecayPerUpdate).toBe(0.03);
    expect(scenario.file.combat.suppressionDecayPerUpdate).not.toBe(0.03);
  });

  it('sets every doctrine with *, and the sim sees it', () => {
    const changed = applySettings(scenario, ['doctrines.*.pinnedSuppression=0.5']);
    expect(Object.values(changed.doctrines).every((doctrine) => doctrine.pinnedSuppression === 0.5)).toBe(true);
  });

  it('rejects a name that doesn\'t exist, or a value the rules don\'t allow', () => {
    expect(() => applySettings(scenario, ['combat.nope=1'])).toThrow(/no "nope"/);
    expect(() => applySettings(scenario, ['combat.suppressionDecayPerUpdate=3'])).toThrow();
  });

  it('reads every --set from the command line', () => {
    expect(settingsFromArgs(['--seeds', '5', '--set', 'a=1', '--set', 'b=2'])).toEqual(['a=1', 'b=2']);
  });
});
