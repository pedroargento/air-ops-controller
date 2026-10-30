import { distance } from '../domain/public/geometry';
import type { ContactId, UnitKnowledge } from '../domain/public/ground';
import { cellAt, type TerrainGrid } from '../domain/public/terrain';
import type { GroundUnit, WorldTruth } from '../domain/truth/world';
import { nextBinomial, type RngState } from '../rng/streams';
import type { CombatConfig } from '../scenario/schema';

export type CombatEffect = Readonly<{
  targetId: string;
  casualties: number;
  suppression: number;
  morale: number;
}>;

type FireSolution = Readonly<{
  firer: GroundUnit;
  target: GroundUnit;
  range: number;
  assessmentSigma: number;
}>;

function unitForContact(truth: WorldTruth, observer: GroundUnit, contactId: ContactId): GroundUnit | null {
  const tracks = truth.tracks[observer.id] ?? {};
  for (const targetId of Object.keys(tracks).sort()) {
    if (tracks[targetId]?.contactId === contactId) {
      return truth.units.find((unit) => unit.id === targetId) ?? null;
    }
  }
  return null;
}

function fireSolutions(
  truth: WorldTruth,
  knowledge: Readonly<Record<string, UnitKnowledge>>,
): readonly FireSolution[] {
  const solutions: FireSolution[] = [];
  for (const firer of truth.units) {
    if (firer.intent.kind !== 'engage' || firer.personnel <= 0 || firer.ammunition <= 0) continue;
    const { contactId } = firer.intent;
    const target = unitForContact(truth, firer, contactId);
    if (target === null || target.personnel <= 0) continue;
    const range = distance(firer.position, target.position);
    if (range > firer.doctrine.engageRangeMeters) continue;
    const assessmentSigma = knowledge[firer.id]?.contacts[contactId]?.position.sigmaMeters ?? 0;
    solutions.push({ firer, target, range, assessmentSigma });
  }
  return solutions;
}

export function effectiveCover(unit: GroundUnit, terrain: TerrainGrid, config: CombatConfig): number {
  const terrainCover = cellAt(terrain, unit.position).groundCover;
  return 1 - (1 - terrainCover) * (1 - config.postureCover[unit.posture]);
}

function volleyEffect(
  { firer, target, range, assessmentSigma }: FireSolution,
  terrain: TerrainGrid,
  config: CombatConfig,
  rng: RngState,
): CombatEffect {
  const rangeFactor =
    config.minRangeFactor + (1 - config.minRangeFactor) * (1 - range / firer.doctrine.engageRangeMeters);
  const moving = firer.posture === 'moving' ? 1 - config.movingFirePenalty : 1;
  // A poorer estimate of where the target is makes fire less effective (§4.1).
  const assessment = 1 / (1 + assessmentSigma / config.assessmentSigmaMeters);
  const volley =
    firer.personnel *
    rangeFactor *
    moving *
    assessment *
    (1 - firer.suppression * config.suppressionFirePenalty);
  const cover = effectiveCover(target, terrain, config);
  const expected = volley * config.lethalityPerManVolley * (1 - cover);
  const hitChance = Math.min(1, expected / target.personnel);
  const casualties = nextBinomial(rng, `combat/${firer.id}/${target.id}`, target.personnel, hitChance);
  return {
    targetId: target.id,
    casualties,
    suppression: (volley * config.suppressionPerManVolley * (1 - cover / 2)) / target.personnel,
    morale: config.moraleLossUnderFirePerUpdate,
  };
}

/** Applies effects together. Effect order is irrelevant because each is additive. */
export function applyEffects(
  truth: WorldTruth,
  effects: readonly CombatEffect[],
  config: CombatConfig,
  tick: number,
): void {
  for (const effect of effects) {
    const target = truth.units.find((unit) => unit.id === effect.targetId);
    if (target === undefined) continue;
    target.lastHitAtTick = tick;
    const casualties = Math.min(target.personnel, effect.casualties);
    target.personnel -= casualties;
    target.suppression = Math.min(1, target.suppression + effect.suppression);
    target.morale = Math.max(
      0,
      target.morale -
        effect.morale -
        (config.moraleLossPerCasualtyFraction * casualties) / target.initialPersonnel,
    );
  }
}

function recover(unit: GroundUnit, config: CombatConfig): void {
  unit.suppression *= 1 - config.suppressionDecayPerUpdate;
  if (unit.mode === 'recovering' && unit.morale < config.moraleRecoveryCap) {
    unit.morale = Math.min(config.moraleRecoveryCap, unit.morale + config.moraleRecoveryPerUpdate);
  }
}

/** One combat update: every effect is computed from the same snapshot, then applied. */
export function resolveCombat(
  truth: WorldTruth,
  knowledge: Readonly<Record<string, UnitKnowledge>>,
  terrain: TerrainGrid,
  config: CombatConfig,
  rng: RngState,
  tick: number,
): void {
  const solutions = fireSolutions(truth, knowledge);
  const effects = solutions.map((solution) => volleyEffect(solution, terrain, config, rng));
  for (const { firer } of solutions) {
    firer.lastFiredAtTick = tick;
    firer.ammunition = Math.max(0, firer.ammunition - firer.personnel * config.ammoPerManVolley);
  }
  for (const unit of truth.units) recover(unit, config);
  applyEffects(truth, effects, config, tick);
}
