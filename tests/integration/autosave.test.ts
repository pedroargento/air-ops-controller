import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import type { AircraftId } from '../../src/domain/public/air';
import { attentionKeys, needsAttention } from '../../src/game/attention';
import { clearSave, readSave, resumeGame, saveGame, type SavedGame, type SaveStore } from '../../src/game/autosave';
import { GameSession } from '../../src/game/session';
import { applySettings } from '../../src/cli/settings';
import { timelineEvents, withSent } from '../../src/ui/timeline';

const scenario = loadScenarioFile('find-them');

function memoryStore(): SaveStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value), removeItem: (key) => void items.delete(key) };
}

/** A battle with an order given part-way, so the log has something to replay. */
function played(ticks: number): GameSession {
  const session = new GameSession(scenario, 7);
  for (let tick = 0; tick < ticks; tick += 1) {
    if (tick === 20) {
      const aircraftId = session.view().aircraft[0]!.aircraftId as AircraftId;
      session.issue({ kind: 'aircraftOrder', aircraftId, order: { kind: 'Watch', center: { x: 2500, y: 2500 }, radius: 1200 }, said: 'Watch the middle.' });
    }
    session.advance();
  }
  return session;
}

describe('autosave', () => {
  it('resumes a saved battle to the same state, and it then plays on identically', () => {
    const original = played(400);
    const store = memoryStore();
    saveGame(store, original, scenario);
    const save = readSave(store);
    expect(save?.ticks).toBe(400);
    const resumed = resumeGame(scenario, save as SavedGame);
    expect(resumed?.stateHash()).toBe(original.stateHash());
    expect(resumed?.commandLog()).toEqual(original.commandLog());
    for (let i = 0; i < 200; i += 1) { original.advance(); resumed?.advance(); }
    expect(resumed?.stateHash()).toBe(original.stateHash());
  });

  it('keeps what the controller said with the command, without it changing the battle', () => {
    const withWords = played(100);
    expect(withWords.commandLog().commands[0]?.said).toBe('Watch the middle.');
    const silent = new GameSession(scenario, 7);
    for (let tick = 0; tick < 100; tick += 1) {
      if (tick === 20) silent.issue({ kind: 'aircraftOrder', aircraftId: silent.view().aircraft[0]!.aircraftId as AircraftId, order: { kind: 'Watch', center: { x: 2500, y: 2500 }, radius: 1200 } });
      silent.advance();
    }
    expect(silent.stateHash()).toBe(withWords.stateHash());
  });

  it('refuses a save from other rules, another scenario, or one that replays differently', () => {
    const store = memoryStore();
    saveGame(store, played(120), scenario);
    const save = readSave(store) as SavedGame;
    const otherRules = applySettings(scenario, ['radio.transmitSeconds=21']);
    expect(resumeGame(otherRules, save)).toBeNull();
    expect(resumeGame(loadScenarioFile('valley-road'), save)).toBeNull();
    expect(resumeGame(scenario, { ...save, stateHash: '00000000' })).toBeNull();
    expect(resumeGame(scenario, { ...save, commands: [{ kind: 'nonsense' }] as unknown as SavedGame['commands'] })).toBeNull();
  });

  it('reads nothing from an empty, broken or cleared store', () => {
    const store = memoryStore();
    expect(readSave(store)).toBeNull();
    store.items.set('airops-autosave', '{not json');
    expect(readSave(store)).toBeNull();
    store.items.set('airops-autosave', JSON.stringify({ scenario: 'find-them', seed: 1 }));
    expect(readSave(store)).toBeNull();
    saveGame(store, played(60), scenario);
    clearSave(store);
    expect(readSave(store)).toBeNull();
    const refusing: SaveStore = { getItem: () => { throw new Error('refused'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('refused'); } };
    expect(() => saveGame(refusing, played(60), scenario)).not.toThrow();
    expect(readSave(refusing)).toBeNull();
    expect(() => clearSave(refusing)).not.toThrow();
  });
});

describe('what stops a fast run', () => {
  it('stops for something new, and not for what was already there', () => {
    const session = played(30);
    const before = session.view();
    const keys = attentionKeys(before);
    expect(needsAttention(keys, before.log.length, before)).toBe(false);
    const aircraft = before.aircraft[0]!;
    const arrived = { ...before, aircraft: [{ ...aircraft, status: 'onStation' as const }, ...before.aircraft.slice(1)] };
    expect(needsAttention(keys, before.log.length, arrived)).toBe(true);
    expect(needsAttention(attentionKeys(arrived), before.log.length, arrived)).toBe(false);
    const request = { unitId: 'F-1', answer: null, dangerClose: false, dangerCloseUntil: null } as unknown as (typeof before.supportRequests)[number];
    expect(needsAttention(keys, before.log.length, { ...before, supportRequests: [request] })).toBe(true);
  });
});

describe('the controller\'s own lines on the timeline', () => {
  it('sit among the radio events in time order', () => {
    const view = played(600).view();
    const events = withSent(timelineEvents(view.log, scenario.terrain.cellSize), [{ tick: 20, text: 'Watch the middle.' }], 'AIR_OPS');
    expect(events.find((event) => event.kind === 'SENT')?.text).toBe('Watch the middle.');
    expect(events.map((event) => event.tick)).toEqual([...events.map((event) => event.tick)].sort((a, b) => a - b));
  });
});
