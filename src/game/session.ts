import type { PlayerAction, PlayerCommand } from '../domain/public/commands';
import type { Debrief } from '../domain/public/debrief';
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

  /** The truth, only once the run is over and there is nothing left to learn from it. */
  debrief(): Debrief | null {
    if (this.outcome === 'running') return null;
    const units = this.state.truth.units;
    const count = (side: 'friendly' | 'enemy', read: (u: (typeof units)[number]) => number): number =>
      units.filter((u) => u.side === side).reduce((sum, u) => sum + read(u), 0);
    return {
      enemyStart: count('enemy', (u) => u.initialPersonnel),
      enemyLeft: count('enemy', (u) => u.personnel),
      enemyFormations: units.filter((u) => u.side === 'enemy').length,
      enemyDestroyed: units.filter((u) => u.side === 'enemy' && u.personnel <= 0).length,
      enemyBroken: units.filter((u) => u.side === 'enemy' && u.personnel > 0 && u.mode === 'broken').length,
      friendlyStart: count('friendly', (u) => u.initialPersonnel),
      friendlyLeft: count('friendly', (u) => u.personnel),
      friendlyDestroyed: units.filter((u) => u.side === 'friendly' && u.personnel <= 0).length,
    };
  }

  view(): PlayerView {
    const { air, display } = this.scenario.file;
    return project(this.state.player, aircraftTelemetry(this.state.truth, air, this.state.tick), this.state.tick, display);
  }

  commandLog(): CommandLog {
    return { seed: this.seed, commands: [...this.log], ticks: this.stepsTaken };
  }

  stateHash(): string {
    return hashState(this.state);
  }
}
