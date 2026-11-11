import { describe, expect, it } from 'vitest';
import { AIRCRAFT_STATUS_LABELS, aircraftStatusLabel, MESSAGE_KIND_LABELS } from '../../src/ui/labels';
import { byDifficulty, difficultyLabel, type ScenarioCard } from '../../src/ui/scenario-menu';
import { scenarioNames } from '../../src/cli/load-scenario';

describe('labels', () => {
  // The tables are full records, so a missing label fails to compile. This guards what they say.
  it.each(Object.entries({ ...AIRCRAFT_STATUS_LABELS, ...MESSAGE_KIND_LABELS }))('%s reads as words', (code, label) => {
    expect(label).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
    expect(label).not.toBe(code);
  });

  it('says a damaged aircraft is damaged, in the air or under repair', () => {
    expect(aircraftStatusLabel('onStation', false)).toBe('On station');
    expect(aircraftStatusLabel('returning', true)).toBe('DAMAGED');
    expect(aircraftStatusLabel('turnaround', true)).toBe('DAMAGED · repair');
  });
});

describe('scenario menu order', () => {
  const card = (id: string): ScenarioCard => ({ id }) as ScenarioCard;

  it('puts the introduction first and the hardest last, with unknown scenarios after', () => {
    const ordered = byDifficulty(['new-one', 'overwatch', 'outpost-under-pressure', 'downed-pilot'].map(card)).map((c) => c.id);
    expect(ordered).toEqual(['downed-pilot', 'outpost-under-pressure', 'overwatch', 'new-one']);
    expect(difficultyLabel('new-one')).toBeNull();
  });

  it('has a difficulty for every scenario in the game', () => {
    expect(scenarioNames().filter((name) => difficultyLabel(name) === null)).toEqual([]);
  });
});
