import { aircraftPerformance, missionEvidence } from '../sim/mission-report';
import type { PlayerAction, PlayerCommand } from '../domain/public/commands';
import type { CasualtyOutcome, Debrief, TruthFrame } from '../domain/public/debrief';

/** How often the true positions are kept for the after-action timeline. */
const HISTORY_INTERVAL_TICKS = 30;
import { sourceScorecard } from '../sim/scorecard';
import type { Outcome, Platoon, WorldTruth } from '../domain/truth/world';
import { project, type PlayerView } from '../knowledge/player-view';
import type { Scenario } from '../scenario/load';
import { aircraftTelemetry } from '../sim/air';
import { platoonPersonnel, sortedPlatoons } from '../sim/platoon';
import { createInitialState, type SimState } from '../sim/state';
import { gameplayHash } from '../sim/state-hash';
import { step } from '../sim/step';
import { woundedCount } from '../sim/wounded';

export type CommandLog = Readonly<{
  scenario: string;
  seed: number;
  commands: readonly PlayerCommand[];
  ticks: number;
}>;

/**
 * Owns a running game: the simulation state, actions waiting for the next tick,
 * and the replayable log. It is the only thing between the player and the sim.
 */
/** What became of one side's casualties, from the truth, for the debrief. */
function casualtyOutcome(truth: WorldTruth, side: 'friendly' | 'enemy'): CasualtyOutcome {
  const ledger = truth.casualties[side];
  const waiting = truth.units.filter((unit) => unit.side === side).reduce((sum, unit) => sum + woundedCount(unit.wounded), 0);
  return {
    killed: ledger.killed,
    wounded: ledger.wounded,
    diedOfWounds: ledger.diedOfWounds,
    evacuated: ledger.evacuated,
    aboard: side === 'friendly' ? truth.aircraft.reduce((sum, aircraft) => sum + woundedCount(aircraft.casualtiesAboard), 0) : 0,
    waiting,
    hospitalMinutes: ledger.evacuated === 0 ? null : Math.round(ledger.hospitalSeconds / ledger.evacuated / 60),
  };
}

export class GameSession {
  private readonly state: SimState;
  private readonly log: PlayerCommand[] = [];
  private pending: PlayerAction[] = [];
  private stepsTaken = 0;
  private readonly frames: TruthFrame[] = [];
  private completedReport: Debrief | null = null;

  constructor(
    private readonly scenario: Scenario,
    private readonly seed: number,
  ) {
    this.state = createInitialState(scenario, seed);
  }

  /**
   * A session brought back from its command log. It stops early if the battle ends, and the
   * caller compares `stateHash()` with the one saved to know the replay took the same course.
   */
  static resume(scenario: Scenario, log: CommandLog): GameSession {
    const session = new GameSession(scenario, log.seed);
    let next = 0;
    for (let tick = 0; tick < log.ticks && session.outcome === 'running'; tick += 1) {
      for (; log.commands[next]?.tick === tick; next += 1) session.issue(log.commands[next] as PlayerCommand);
      session.advance();
    }
    return session;
  }

  /** How many commands have been applied, so a caller can tell when there is something new to save. */
  get commandCount(): number {
    return this.log.length;
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
    if (this.state.tick % HISTORY_INTERVAL_TICKS === 0) this.record();
  }

  private record(): void {
    this.frames.push({
      tick: this.state.tick,
      squads: this.state.truth.units.map((unit) => ({
        id: unit.id,
        side: unit.side === 'friendly' ? 'friendly' : 'enemy',
        x: unit.position.x,
        y: unit.position.y,
        alive: unit.personnel > 0,
      })),
    });
  }

  /** Where everyone really was through the run: only once it's over, like the debrief. */
  truthHistory(): readonly TruthFrame[] | null {
    return this.outcome === 'running' ? null : this.frames;
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
    if (this.completedReport !== null) return this.completedReport;
    const { truth } = this.state;
    const platoons = sortedPlatoons(truth);
    // Rescued squads leave the operational map but still belong in personnel totals.
    const units = platoons.flatMap((platoon) => platoon.squads);
    const lost = (platoon: Platoon): boolean => platoonPersonnel(platoon) <= 0;
    const sources = sourceScorecard(truth, this.state.player);
    const count = (side: 'friendly' | 'enemy', read: (u: (typeof units)[number]) => number): number =>
      units.filter((u) => u.side === side).reduce((sum, u) => sum + read(u), 0);
    this.completedReport = {
      mission: {
        name: this.scenario.file.name, objective: this.scenario.file.mission.briefing,
        result: this.scenario.file.mission.results[this.outcome as 'success' | 'partial' | 'failure'],
        elapsedSeconds: this.tick, evidence: missionEvidence(truth, this.scenario),
      },
      aircraft: aircraftPerformance(truth, this.scenario),
      enemyStart: count('enemy', (u) => u.initialPersonnel),
      enemyLeft: count('enemy', (u) => u.personnel),
      enemyFormations: platoons.filter((p) => p.side === 'enemy').length,
      enemyDestroyed: platoons.filter((p) => p.side === 'enemy' && lost(p)).length,
      enemyBroken: platoons.filter((p) => p.side === 'enemy' && !lost(p) && p.mode === 'broken').length,
      friendlyStart: count('friendly', (u) => u.initialPersonnel),
      friendlyLeft: count('friendly', (u) => u.personnel),
      friendlyDestroyed: platoons.filter((p) => p.side === 'friendly' && lost(p)).length,
      locatedShare: truth.locatedShare,
      friendlyFireCasualties: truth.friendlyFireCasualties,
      casualties: { friendly: casualtyOutcome(truth, 'friendly'), enemy: casualtyOutcome(truth, 'enemy') },
      airClaims: this.state.player.estimatedLosses,
      groundClaims: sources.filter((source) => !this.isAircraft(source.sourceId)).reduce((sum, source) => sum + source.claimed, 0),
      sources,
    };
    return this.completedReport;
  }

  private isAircraft(id: string): boolean {
    return this.state.truth.aircraft.some((aircraft) => aircraft.id === id);
  }

  view(): PlayerView {
    const { air, display } = this.scenario.file;
    return project(this.state.player, aircraftTelemetry(this.state.truth, air, this.state.tick), this.state.tick, display);
  }

  commandLog(): CommandLog {
    return { scenario: this.scenario.file.id, seed: this.seed, commands: [...this.log], ticks: this.stepsTaken };
  }

  stateHash(): string {
    return gameplayHash(this.state);
  }
}
