import { aircraftPerformance } from '../sim/mission-report';
import type { AircraftPerformance } from '../domain/public/debrief';
import type { DrillKind } from '../domain/public/ground';
import { totalAmmunition } from '../domain/public/equipment';
import type { CasualtyLedger, Outcome, WorldTruth } from '../domain/truth/world';
import { woundedCount } from '../sim/wounded';
import { project } from '../knowledge/player-view';
import type { Policy } from '../policies/air-policies';
import type { Scenario } from '../scenario/load';
import { aircraftTelemetry } from '../sim/air';
import { strengthInArea } from '../sim/outcome';
import { createInitialState, type SimState } from '../sim/state';
import { sortedPlatoons } from '../sim/platoon';
import { step } from '../sim/step';
import { TempoTracker, type Tempo } from './tempo';

const POLICY_INTERVAL_TICKS = 5;

export type BattleResult = Readonly<{
  aircraft: readonly AircraftPerformance[];
  seed: number;
  outcome: Outcome;
  endedAtTick: number;
  friendlyPersonnel: number;
  enemyPersonnel: number;
  effectiveDefenders: number;
  friendlyAmmunitionUsed: number;
  firstShotTick: number | null;
  enemyUnitsThatFought: number;
  enemyUnitsTotal: number;
  repeatReturns: number;
  sorties: number;
  strikePasses: number;
  unusedOrdnance: number;
  firstRequestTick: number | null;
  firstStrikeTick: number | null;
  aircraftHits: number;
  groundFireReports: number;
  drills: readonly DrillKind[];
  tempo: Tempo;
  /** What really happened to each side's men (§4.1.1), with wounded still waiting at the end. */
  casualties: Readonly<Record<'friendly' | 'enemy', CasualtyLedger & Readonly<{ waiting: number; aboard: number }>>>;
  /** Hits that sent a helicopter with seats home (§8.9). */
  helicopterHits: number;
}>;

function personnel(truth: WorldTruth, side: 'friendly' | 'enemy'): number {
  return truth.units.filter((u) => u.side === side).reduce((sum, u) => sum + u.personnel, 0);
}

function ledger(truth: WorldTruth, side: 'friendly' | 'enemy'): CasualtyLedger & Readonly<{ waiting: number; aboard: number }> {
  const waiting = truth.units.filter((u) => u.side === side).reduce((sum, u) => sum + woundedCount(u.wounded), 0);
  // Helicopters only ever carry friendly wounded.
  const aboard = side === 'friendly' ? truth.aircraft.reduce((sum, a) => sum + woundedCount(a.casualtiesAboard), 0) : 0;
  return { ...truth.casualties[side], waiting, aboard };
}

export function runBattle(
  scenario: Scenario,
  seed: number,
  policy: Policy,
  onTick?: (state: SimState) => void,
): BattleResult {
  const state = createInitialState(scenario, seed);
  const { truth } = state;
  const { air, display } = scenario.file;
  let firstShotTick: number | null = null;
  let sorties = 0;
  const fought = new Set<string>();
  const tempo = new TempoTracker(state, scenario);

  while (truth.outcome === 'running') {
    const decide = state.tick % POLICY_INTERVAL_TICKS === 0;
    const commands = decide
      ? policy(project(state.player, aircraftTelemetry(truth, air, state.tick), state.tick, display))
      : [];
    const readyBefore = truth.aircraft.filter((a) => a.status === 'ready').length;
    step(state, commands, scenario);
    sorties += Math.max(0, readyBefore - truth.aircraft.filter((a) => a.status === 'ready').length);
    tempo.observe(state);
    onTick?.(state);
    for (const unit of truth.units) {
      if (unit.lastFiredAtTick === null) continue;
      firstShotTick ??= unit.lastFiredAtTick;
      if (unit.side === 'enemy') fought.add(unit.platoonId);
    }
  }

  const friendly = truth.units.filter((u) => u.side === 'friendly');
  const platoons = sortedPlatoons(truth);
  const strikes = state.player.log.filter((m) => m.kind === 'STRIKE_RESULT');
  const fired = state.player.log.flatMap((m) => (m.kind === 'GROUND_FIRE' ? [m] : []));
  return {
    aircraft: aircraftPerformance(truth, scenario),
    seed,
    outcome: truth.outcome,
    endedAtTick: truth.endedAtTick ?? state.tick,
    friendlyPersonnel: personnel(truth, 'friendly'),
    enemyPersonnel: personnel(truth, 'enemy'),
    effectiveDefenders: strengthInArea(truth, 'friendly', scenario.file.mission),
    friendlyAmmunitionUsed:
      1 -
      friendly.reduce((sum, u) => sum + totalAmmunition(u.equipment), 0) /
        friendly.reduce((sum, u) => sum + u.initialAmmunition, 0),
    firstShotTick,
    enemyUnitsThatFought: fought.size,
    enemyUnitsTotal: platoons.filter((p) => p.side === 'enemy').length,
    repeatReturns: platoons.reduce((sum, p) => sum + p.returnsUsed, 0),
    sorties,
    strikePasses: strikes.length,
    unusedOrdnance: truth.aircraft.reduce((sum, a) => sum + a.ammunition, 0),
    firstRequestTick: state.player.log.find((m) => m.kind === 'SUPPORT_REQUEST')?.receivedAt ?? null,
    firstStrikeTick: strikes[0]?.receivedAt ?? null,
    aircraftHits: fired.filter((m) => m.damaged).length,
    groundFireReports: fired.length,
    drills: state.player.log.flatMap((m) => (m.kind === 'DRILL' ? [m.drill] : [])),
    tempo: tempo.finish(state),
    casualties: { friendly: ledger(truth, 'friendly'), enemy: ledger(truth, 'enemy') },
    helicopterHits: fired.filter((m) => m.damaged && truth.aircraft.some((a) => a.id === m.senderId && air.models[a.model]?.seats !== undefined && (air.models[a.model]?.seats ?? 0) > 0)).length,
  };
}
