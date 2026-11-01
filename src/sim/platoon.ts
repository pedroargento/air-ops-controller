import { airWeapons, supportWeaponCount, totalAmmunition, type Equipment } from '../domain/public/equipment';
import { cos, hypot, sin } from '../domain/public/det-math';
import { distance, type Vec2 } from '../domain/public/geometry';
import type { Area, GroundObjective, UnitId, UnitSelf } from '../domain/public/ground';
import type { GroundUnit, Platoon, ScheduledObjective, WorldTruth } from '../domain/truth/world';
import type { Scenario } from '../scenario/load';
import type { ScenarioFile } from '../scenario/schema';

type PlatoonFile = ScenarioFile['units'][number];

const SLOT_RING = 0.7;

export function livingSquads(platoon: Platoon): readonly GroundUnit[] {
  return platoon.squads.filter((unit) => unit.personnel > 0);
}

export function platoonOf(truth: WorldTruth, unit: GroundUnit): Platoon {
  const platoon = truth.platoons[unit.platoonId];
  if (platoon === undefined) throw new Error(`Squad ${unit.id} has no platoon`);
  return platoon;
}

export function sortedPlatoons(truth: WorldTruth): readonly Platoon[] {
  return Object.values(truth.platoons);
}

export function platoonPersonnel(platoon: Platoon): number {
  return platoon.squads.reduce((sum, unit) => sum + unit.personnel, 0);
}

/** Largest-remainder split, so shares always add up to `total` and early squads get any spare. */
export function shareOut(total: number, shares: number): readonly number[] {
  const base = Math.floor(total / shares);
  const spare = total - base * shares;
  return Array.from({ length: shares }, (_, index) => base + (index < spare ? 1 : 0));
}

function squadEquipment(equipment: readonly Equipment[], personnel: readonly number[]): readonly (readonly Equipment[])[] {
  const total = personnel.reduce((sum, count) => sum + count, 0);
  const squads = personnel.map((): Equipment[] => []);
  for (const item of equipment) {
    const quantities =
      item.weapon === 'SMALL_ARMS' ? personnel : shareOut(item.quantity, personnel.length);
    const carried = item.weapon === 'SMALL_ARMS' ? total : item.quantity;
    quantities.forEach((quantity, index) => {
      squads[index]?.push({ weapon: item.weapon, quantity, ammunition: (item.ammunition * quantity) / carried });
    });
  }
  return squads;
}

function firstDestination(objective: GroundObjective): Vec2 | null {
  if (objective.kind === 'PatrolArea') return objective.waypoints[0] ?? null;
  return objective.area.center;
}

function ringSlot(index: number, count: number): Vec2 {
  if (count === 1) return { x: 0, y: 0 };
  const angle = (2 * Math.PI * index) / count;
  return { x: SLOT_RING * cos(angle), y: SLOT_RING * sin(angle) };
}

/** Squads start on a platoon's hold area, or in column towards where it's going. */
function startPosition(file: PlatoonFile, slot: Vec2, index: number, count: number, spacing: number): Vec2 {
  const { objective, position } = file;
  if (count === 1) return position;
  const holds = objective.kind === 'HoldArea' || objective.kind === 'AmbushArea';
  if (holds && distance(position, objective.area.center) <= objective.area.radius * 2) {
    const { center, radius } = objective.area;
    return { x: center.x + slot.x * radius, y: center.y + slot.y * radius };
  }
  const destination = firstDestination(objective) ?? position;
  const gap = hypot(destination.x - position.x, destination.y - position.y);
  if (gap === 0) return position;
  const along = ((count - 1) / 2 - index) * spacing;
  return {
    x: position.x + ((destination.x - position.x) / gap) * along,
    y: position.y + ((destination.y - position.y) / gap) * along,
  };
}

export function createSquads(file: PlatoonFile, scenario: Scenario): readonly GroundUnit[] {
  const { squadSize, columnSpacingMeters } = scenario.file.combat;
  const doctrine = scenario.doctrines[file.doctrine];
  if (doctrine === undefined) throw new Error(`Unknown doctrine ${file.doctrine}`);
  const count = Math.max(1, Math.round(file.personnel / squadSize));
  const personnel = shareOut(file.personnel, count);
  const equipment = squadEquipment(file.equipment, personnel);
  return personnel.map((size, index): GroundUnit => {
    const slot = ringSlot(index, count);
    const gear = equipment[index] ?? [];
    return {
      id: `${file.id}/${index + 1}` as UnitId,
      platoonId: file.id as UnitId,
      slot,
      name: `${file.name} ${index + 1}`,
      side: file.side,
      position: startPosition(file, slot, index, count, columnSpacingMeters),
      navOffset: { x: 0, y: 0 },
      navMeters: 0,
      personnel: size,
      initialPersonnel: size,
      equipment: [...gear],
      initialAmmunition: totalAmmunition(gear),
      firedWeapons: [],
      firesAtAircraft: false,
      nextAirFireTick: 0,
      suppression: 0,
      posture: 'defending',
      behavior: null,
      behaviorSinceTick: 0,
      patrolIndex: 0,
      doctrine,
      role: null,
      viaDone: false,
      avoid: null,
      routeAvoid: null,
      intent: { kind: 'wait' },
      route: [],
      routeDestination: null,
      lastFiredAtTick: null,
      lastHitAtTick: null,
    };
  });
}

function scheduledObjective(entry: PlatoonFile['objectiveSchedule'][number]): ScheduledObjective {
  if ('fromSeconds' in entry) return { kind: 'time', fromTick: entry.fromSeconds, objective: entry.objective };
  if ('afterObjective' in entry) return { kind: 'objectiveDone', objective: entry.objective };
  return { kind: 'contactReported', radiusMeters: entry.radiusMeters };
}

export function createPlatoon(file: PlatoonFile, squads: readonly GroundUnit[], scenario: Scenario): Platoon {
  const doctrine = scenario.doctrines[file.doctrine];
  if (doctrine === undefined) throw new Error(`Unknown doctrine ${file.doctrine}`);
  return {
    id: file.id as UnitId,
    name: file.name,
    side: file.side,
    squads,
    initialPersonnel: file.personnel,
    initialAmmunition: totalAmmunition(file.equipment),
    morale: file.morale,
    mode: 'steady',
    returnsUsed: 0,
    objective: file.objective,
    objectiveSchedule: file.objectiveSchedule.map(scheduledObjective),
    ordersUsed: [],
    drill: null,
    ambushSprung: false,
    ambushSprungAt: null,
    handled: [],
    fallback: file.fallback satisfies Area,
    doctrine,
    activeFromTick: file.activeFromSeconds,
  };
}

function mergedEquipment(squads: readonly GroundUnit[]): readonly Equipment[] {
  const merged = new Map<Equipment['weapon'], Equipment>();
  for (const { equipment } of squads) {
    for (const item of equipment) {
      const held = merged.get(item.weapon);
      merged.set(item.weapon, {
        weapon: item.weapon,
        quantity: (held?.quantity ?? 0) + item.quantity,
        ammunition: (held?.ammunition ?? 0) + item.ammunition,
      });
    }
  }
  return [...merged.values()];
}

/** The platoon seen as one unit, for its own decisions and its radio. */
export function platoonSelf(
  platoon: Platoon,
  squads: readonly GroundUnit[],
  selves: ReadonlyMap<string, UnitSelf>,
  scenario: Scenario,
): UnitSelf | null {
  const lead = squads[0];
  const leadSelf = lead === undefined ? undefined : selves.get(lead.id);
  if (lead === undefined || leadSelf === undefined) return null;
  const personnel = squads.reduce((sum, unit) => sum + unit.personnel, 0);
  const mean = (read: (unit: GroundUnit) => number): number =>
    squads.reduce((sum, unit) => sum + read(unit), 0) / squads.length;
  const position = { x: mean((unit) => unit.position.x), y: mean((unit) => unit.position.y) };
  const equipment = mergedEquipment(squads);
  const { weapons } = scenario.file.combat;
  return {
    ...leadSelf,
    id: platoon.id,
    position,
    slot: { x: 0, y: 0 },
    platoonPersonnel: personnel,
    squads: squads.length,
    ownPosition: {
      ...leadSelf.ownPosition,
      center: { x: position.x + mean((unit) => unit.navOffset.x), y: position.y + mean((unit) => unit.navOffset.y) },
    },
    personnel,
    initialPersonnel: platoon.initialPersonnel,
    ammunition: totalAmmunition(equipment),
    initialAmmunition: platoon.initialAmmunition,
    equipment,
    supportWeapons: supportWeaponCount(equipment, personnel, weapons),
    airWeapons: airWeapons(equipment, personnel, weapons),
    suppression: squads.reduce((sum, unit) => sum + unit.suppression * unit.personnel, 0) / Math.max(1, personnel),
    underFire: squads.some((unit) => selves.get(unit.id)?.underFire === true),
  };
}
