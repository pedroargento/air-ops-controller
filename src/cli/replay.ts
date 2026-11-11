import type { PlayerCommand } from '../domain/public/commands';
import type { Scenario } from '../scenario/load';
import { createInitialState } from '../sim/state';
import { gameplayHash } from '../sim/state-hash';
import { step } from '../sim/step';

export type Replay = Readonly<{
  scenario?: string;
  seed: number;
  commands: readonly PlayerCommand[];
  ticks: number;
}>;

export function runReplay(scenario: Scenario, replay: Replay): readonly string[] {
  if (replay.scenario !== undefined && replay.scenario !== scenario.file.id) {
    throw new Error(`Replay is for ${replay.scenario}, not ${scenario.file.id}`);
  }
  const hashes: string[] = [];
  const state = createInitialState(scenario, replay.seed);
  for (let tick = 0; tick < replay.ticks; tick += 1) {
    const due = replay.commands.filter((command) => command.tick === tick);
    step(state, due, scenario);
    hashes.push(gameplayHash(state));
  }
  return hashes;
}

/** Returns the first tick whose hash differs, or null when the runs match. */
export function firstDivergence(
  a: readonly string[],
  b: readonly string[],
): number | null {
  const length = Math.max(a.length, b.length);
  for (let tick = 0; tick < length; tick += 1) {
    if (a[tick] !== b[tick]) return tick;
  }
  return null;
}
