// The battle in progress, kept in the browser so that a reload or a closed tab doesn't lose it.
// Only the command log is stored: the simulation is deterministic, so replaying it gives the
// same battle, and the saved hash proves it did.
import { hashState } from '../domain/public/hash';
import type { Scenario } from '../scenario/load';
import { GameSession, type CommandLog } from './session';

const KEY = 'airops-autosave';

export type SavedGame = CommandLog & Readonly<{
  /** Hash of the scenario and its rules, so a save from other rules is never replayed. */
  rulesHash: string;
  /** Hash of the state when saved, which the replay must reach. */
  stateHash: string;
}>;

/** What a save needs from storage: the browser's, or a stand-in. Any call may throw. */
export type SaveStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function rulesHash(scenario: Scenario): string {
  return hashState(scenario.file);
}

export function saveGame(store: SaveStore, session: GameSession, scenario: Scenario): void {
  const saved: SavedGame = { ...session.commandLog(), rulesHash: rulesHash(scenario), stateHash: session.stateHash() };
  try {
    store.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage full or refused: the game goes on without a save.
  }
}

export function clearSave(store: SaveStore): void {
  try {
    store.removeItem(KEY);
  } catch {
    // Nothing to clear if storage can't be reached.
  }
}

function isSavedGame(value: unknown): value is SavedGame {
  if (typeof value !== 'object' || value === null) return false;
  const save = value as Record<string, unknown>;
  return typeof save['scenario'] === 'string' && Number.isSafeInteger(save['seed']) && Number.isSafeInteger(save['ticks']) &&
    (save['ticks'] as number) > 0 && Array.isArray(save['commands']) && typeof save['rulesHash'] === 'string' && typeof save['stateHash'] === 'string';
}

/** The save as stored, or null if there is none or it can't be read. */
export function readSave(store: SaveStore): SavedGame | null {
  try {
    const value: unknown = JSON.parse(store.getItem(KEY) ?? 'null');
    return isSavedGame(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The saved battle, replayed, or null when the save is for another scenario or other rules, or
 * the replay doesn't arrive at the saved state. A save that can't be resumed is of no use.
 */
export function resumeGame(scenario: Scenario, save: SavedGame): GameSession | null {
  if (save.scenario !== scenario.file.id || save.rulesHash !== rulesHash(scenario)) return null;
  try {
    const session = GameSession.resume(scenario, save);
    return session.stateHash() === save.stateHash ? session : null;
  } catch {
    return null;
  }
}
