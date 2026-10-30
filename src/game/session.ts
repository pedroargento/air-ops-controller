import type { PlayerAction, PlayerCommand } from '../domain/public/commands';
import { hashState } from '../domain/public/hash';
import type { Outcome } from '../domain/truth/world';
import { project, type PlayerView } from '../knowledge/player-view';
import type { Scenario } from '../scenario/load';
import { aircraftTelemetry } from '../sim/air';
import { createInitialState, type SimState } from '../sim/state';
import { step } from '../sim/step';

export type CommandLog = Readonly<{
  seed: number;
  commands: readonly PlayerCommand[];
  ticks: number;
}>;

/**
 * Owns a running game: the simulation state, actions waiting for the next tick,
 * and the replayable log. It is the only thing between the player and the sim.
 */
export class GameSession {
  private readonly state: SimState;
  private readonly log: PlayerCommand[] = [];
  private pending: PlayerAction[] = [];
  private stepsTaken = 0;

  constructor(
    private readonly scenario: Scenario,
    private readonly seed: number,
  ) {
    this.state = createInitialState(scenario, seed);
  }

  /** Works while paused too: the action waits for the next tick that runs. */
  issue(action: PlayerAction): void {
    this.pending.push(action);
  }

  advance(): void {
    if (this.outcome !== 'running') return;
    const commands = this.pending.map((action) => ({ ...action, tick: this.state.tick }) as PlayerCommand);
    this.pending = [];
    this.log.push(...commands);
    step(this.state, commands, this.scenario);
    this.stepsTaken += 1;
  }

  get outcome(): Outcome {
    return this.state.truth.outcome;
  }

  get tick(): number {
    return this.state.tick;
  }

  view(): PlayerView {
    const { air, display } = this.scenario.file;
    return project(this.state.player, aircraftTelemetry(this.state.truth, air), this.state.tick, display);
  }

  commandLog(): CommandLog {
    return { seed: this.seed, commands: [...this.log], ticks: this.stepsTaken };
  }

  stateHash(): string {
    return hashState(this.state);
  }
}
