import { distance } from '../domain/public/geometry';
import type { Drill, DrillCoordination, DrillMap, GroundExperiment, SquadRole, SquadStatus, UnitKnowledge, UnitSelf } from '../domain/public/ground';
import { assignRoles, willingToAttack } from './drills';

/** A capability check against an estimated position, never against an enemy unit. */
function canSupport(squad: SquadStatus, self: UnitSelf, drill: Drill, map: DrillMap): boolean {
  return squad.personnel > 0 && squad.ammunition > 0 && squad.suppression < self.doctrine.pinnedSuppression &&
    distance(squad.position, drill.target) <= self.doctrine.engageRangeMeters && map.sees(squad.position, drill.target);
}

/**
 * Local platoon coordination. Inputs contain own status, reported enemies and the chosen
 * estimated target. A volley confirms that support fired, not that it hit or suppressed anything.
 */
export function coordinateDrill(self: UnitSelf, knowledge: UnitKnowledge, drill: Drill, tick: number, map: DrillMap, experiment?: GroundExperiment): DrillCoordination {
  const squads = self.ownSquads.filter((squad) => squad.personnel > 0);
  const ranges = squads.map((squad) => distance(squad.position, drill.target));
  const initial = assignRoles(drill, self.doctrine, ranges);
  const roles: Record<string, SquadRole> = Object.fromEntries(squads.map((squad, i) => [squad.id, initial[i] ?? 'hold']));
  if (drill.kind === 'nearAmbush') {
    for (const squad of squads) {
      roles[squad.id] = squad.underFire && distance(squad.position, drill.target) <= self.doctrine.nearAmbushMeters ? 'assault' : 'support';
    }
    return { phase: Object.values(roles).includes('assault') ? 'assault' : 'establish', roles, waitReason: null };
  }
  if (drill.kind !== 'attack' && drill.kind !== 'farAmbush') return { phase: 'maneuver', roles, waitReason: null };
  const willing = experiment?.attackReassessment === false || willingToAttack(self, knowledge, drill.target, tick);
  if (!initial.includes('maneuver')) {
    // A depleted platoon cannot turn the loss of its supporting element into permission to charge.
    if (drill.via !== null || (drill.kind === 'attack' && !willing)) {
      for (const squad of squads) roles[squad.id] = 'cover';
      return { phase: 'establish', roles, waitReason: drill.via !== null ? 'capacity' : 'doctrine' };
    }
    return { phase: initial.includes('assault') ? 'assault' : 'establish', roles, waitReason: null };
  }

  const count = initial.filter((role) => role === 'support').length;
  const usable = (squad: SquadStatus): boolean => squad.ammunition > 0 && squad.suppression < self.doctrine.pinnedSuppression;
  const ordered = [...squads].sort((a, b) =>
    Number(canSupport(b, self, drill, map)) - Number(canSupport(a, self, drill, map)) ||
    Number(usable(b)) - Number(usable(a)) ||
    Number(b.role === 'support') - Number(a.role === 'support') ||
    b.supportWeapons - a.supportWeapons ||
    distance(a.position, drill.target) - distance(b.position, drill.target) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const support = ordered.slice(0, count);
  const supportIds = new Set(support.map((squad) => squad.id));
  for (const squad of squads) roles[squad.id] = supportIds.has(squad.id) ? 'support' : 'maneuver';
  const ready = support.some((squad) => {
    const volley = squad.groundVolley;
    return canSupport(squad, self, drill, map) && volley !== null && volley.at >= drill.startedAt &&
      tick - volley.at <= self.doctrine.supportFireMemorySeconds &&
      distance(volley.aim, drill.target) <= drill.radius;
  });
  // The approach remains in every ablation: disabling a gate must not also change the route.
  if (!ready && willing && squads.every((squad) => distance(squad.position, drill.target) > self.doctrine.engageRangeMeters)) {
    return { phase: 'approach', roles, waitReason: null };
  }
  if (!willing) return { phase: 'establish', roles, waitReason: 'doctrine' };
  if (!ready && experiment?.supportGate !== false) return { phase: 'establish', roles, waitReason: 'support' };
  const maneuver = squads.filter((squad) => !supportIds.has(squad.id));
  const assembled = maneuver.every((squad) => squad.role === 'maneuver' && squad.viaDone);
  const assembling = !assembled && experiment?.assemblyGate !== false;
  return { phase: assembling ? 'maneuver' : 'assault', roles,
    waitReason: assembling && maneuver.some((squad) => squad.viaDone) ? 'assembly' : null };
}
