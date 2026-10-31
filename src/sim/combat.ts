import { totalAmmunition, usableWeapons, type WeaponFire } from '../domain/public/equipment';
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
  fire: readonly WeaponFire[];
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
  config: CombatConfig,
): readonly FireSolution[] {
  const solutions: FireSolution[] = [];
  for (const firer of truth.units) {
    if (firer.intent.kind !== 'engage' || firer.personnel <= 0) continue;
    const { contactId } = firer.intent;
    const target = unitForContact(truth, firer, contactId);
    if (target === null || target.personnel <= 0) continue;
    const range = distance(firer.position, target.position);
    if (range > firer.doctrine.engageRangeMeters) continue;
    const fire = usableWeapons(firer.equipment, firer.personnel, config.weapons).filter(({ weapon }) => {
      const definition = config.weapons[weapon];
      return definition.targetDomains.includes('GROUND') && range <= definition.rangeMeters;
    });
    if (fire.length === 0) continue;
    const assessmentSigma = knowledge[firer.id]?.contacts[contactId]?.position.sigmaMeters ?? 0;
    solutions.push({ firer, target, range, assessmentSigma, fire });
  }
  return solutions;
}

export function effectiveCover(unit: GroundUnit, terrain: TerrainGrid, config: CombatConfig): number {
  const terrainCover = cellAt(terrain, unit.position).groundCover;
  return 1 - (1 - terrainCover) * (1 - config.postureCover[unit.posture]);
}

function volleyEffect(
  { firer, target, range, assessmentSigma, fire }: FireSolution,
  terrain: TerrainGrid,
  config: CombatConfig,
  rng: RngState,
): CombatEffect {
  const moving = firer.posture === 'moving' ? 1 - config.movingFirePenalty : 1;
  const fireRate = firer.intent.kind === 'engage' ? firer.intent.fireRate : 1;
  // A poorer estimate of where the target is makes fire less effective (§4.1).
  const assessment = 1 / (1 + assessmentSigma / config.assessmentSigmaMeters);
  const shared = fireRate * moving * assessment * (1 - firer.suppression * config.suppressionFirePenalty);
  let damage = 0;
  let suppression = 0;
  for (const { weapon, count } of fire) {
    const definition = config.weapons[weapon];
    const rangeFactor =
      config.minRangeFactor + (1 - config.minRangeFactor) * (1 - range / definition.rangeMeters);
    damage += count * shared * rangeFactor * definition.damageEffect;
    suppression += count * shared * rangeFactor * definition.suppressionEffect;
  }
  const cover = effectiveCover(target, terrain, config);
  const hitChance = Math.min(1, (damage * (1 - cover)) / target.personnel);
  const casualties = nextBinomial(rng, `combat/${firer.id}/${target.id}`, target.personnel, hitChance);
  return {
    targetId: target.id,
    casualties,
    suppression: (suppression * (1 - cover / 2)) / target.personnel,
    morale: 0,
  };
}

function spendAmmunition({ firer, fire }: FireSolution, config: CombatConfig): void {
  const fireRate = firer.intent.kind === 'engage' ? firer.intent.fireRate : 1;
  firer.equipment = firer.equipment.map((item) => {
    const firing = fire.find(({ weapon }) => weapon === item.weapon);
    if (firing === undefined) return item;
    const used = firing.count * fireRate * config.weapons[item.weapon].ammunitionPerUse;
    return { ...item, ammunition: Math.max(0, item.ammunition - used) };
  });
  firer.firedWeapons = fire.map(({ weapon }) => weapon);
}

/** Casualties can take specialist weapons with them; small arms just follow personnel. */
function destroySystems(unit: GroundUnit, casualties: number, config: CombatConfig, rng: RngState): void {
  const fraction = Math.min(1, ((casualties / unit.personnel) * config.systemLossPerCasualtyFraction));
  unit.equipment = unit.equipment.map((item) => {
    if (item.weapon === 'SMALL_ARMS' || item.quantity <= 0) return item;
    const lost = nextBinomial(rng, `equipment/${unit.id}/${item.weapon}`, item.quantity, fraction);
    return { ...item, quantity: item.quantity - lost };
  });
}

/** Applies effects together. Effect order is irrelevant because each is additive. */
export function applyEffects(
  truth: WorldTruth,
  effects: readonly CombatEffect[],
  config: CombatConfig,
  rng: RngState,
  tick: number,
): void {
  for (const effect of effects) {
    const target = truth.units.find((unit) => unit.id === effect.targetId);
    if (target === undefined) continue;
    target.lastHitAtTick = tick;
    const casualties = Math.min(target.personnel, effect.casualties);
    if (casualties > 0) destroySystems(target, casualties, config, rng);
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

function isolated(unit: GroundUnit, truth: WorldTruth, config: CombatConfig): boolean {
  return !truth.units.some(
    (other) =>
      other !== unit &&
      other.side === unit.side &&
      other.personnel > 0 &&
      other.mode !== 'broken' &&
      distance(other.position, unit.position) <= config.isolationRadiusMeters,
  );
}

/**
 * Pressure counts once per update however many units are firing (§4.1). Fire alone
 * stops at the doctrine's floor; going lower takes a deteriorating situation.
 */
function applyPressure(unit: GroundUnit, truth: WorldTruth, config: CombatConfig): void {
  const floor = unit.doctrine.pressureMoraleFloor;
  if (unit.morale > floor) {
    unit.morale = Math.max(floor, unit.morale - config.moraleLossUnderFirePerUpdate);
  }
  const lowAmmunition = totalAmmunition(unit.equipment) <= unit.initialAmmunition * config.lowAmmunitionFraction;
  if (lowAmmunition || isolated(unit, truth, config)) {
    unit.morale = Math.max(0, unit.morale - config.moraleLossDeterioratingPerUpdate);
  }
}

function moraleCap(unit: GroundUnit, config: CombatConfig): number {
  // Gentler than the casualty fraction, so that a unit fit to return can still reach its return morale.
  return config.moraleRecoveryCap * (1 - (1 - unit.personnel / unit.initialPersonnel) / 2);
}

function recover(unit: GroundUnit, config: CombatConfig, tick: number): void {
  unit.suppression *= 1 - config.suppressionDecayPerUpdate;
  const quiet = unit.lastHitAtTick === null || tick - unit.lastHitAtTick >= config.outOfContactSeconds;
  if (!quiet) return;
  const rate = unit.mode === 'recovering' ? config.moraleRecoveryPerUpdate : config.moraleRecoveryOutOfContactPerUpdate;
  const cap = moraleCap(unit, config);
  if (unit.morale < cap) unit.morale = Math.min(cap, unit.morale + rate);
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
  const solutions = fireSolutions(truth, knowledge, config);
  const effects = solutions.map((solution) => volleyEffect(solution, terrain, config, rng));
  for (const solution of solutions) {
    solution.firer.lastFiredAtTick = tick;
    spendAmmunition(solution, config);
  }
  for (const unit of truth.units) recover(unit, config, tick);
  applyEffects(truth, effects, config, rng, tick);
  const hit = new Set(effects.map((effect) => effect.targetId));
  for (const unit of truth.units) {
    if (hit.has(unit.id)) applyPressure(unit, truth, config);
  }
}
