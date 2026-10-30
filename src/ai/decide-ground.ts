import { strengthMidpoint, type ContactEstimate } from '../domain/public/estimates';
import { distance, type Vec2 } from '../domain/public/geometry';
import type {
  Area,
  GroundDecision,
  GroundIntent,
  GroundMode,
  UnitKnowledge,
  UnitSelf,
} from '../domain/public/ground';

const ENGAGE_MEMORY_TICKS = 20;
const REPOSITION_ARRIVED_METERS = 25;

// The same function drives both sides. It reads only the unit's own state and
// its beliefs; faction never appears in a branch.
export function decideGround(self: UnitSelf, knowledge: UnitKnowledge, tick: number): GroundDecision {
  const mode = nextMode(self, knowledge, tick);
  const returnsUsed = mode === 'steady' && self.mode === 'recovering' ? self.returnsUsed + 1 : self.returnsUsed;
  const patrolIndex = nextPatrolIndex(self);
  const decision = (intent: GroundIntent): GroundDecision => ({ intent, mode, returnsUsed, patrolIndex });

  if (mode === 'withdrawing') {
    return decision({ kind: 'move', destination: withdrawalPoint(self, knowledge, tick) });
  }
  if (mode === 'recovering' || mode === 'broken') {
    return decision({ kind: 'hold', posture: 'defending' });
  }

  const target = chooseTarget(self, knowledge, tick);
  if (target !== null && self.ammunition > 0) return decision(engage(self, target));
  if (self.suppression >= self.doctrine.pinnedSuppression) {
    return decision({ kind: 'hold', posture: 'prone' });
  }
  if (takingAirCover(self, knowledge, tick)) return decision({ kind: 'hold', posture: 'prone' });
  return decision(pursueObjective(self, knowledge, patrolIndex, tick));
}

function takingAirCover(self: UnitSelf, knowledge: UnitKnowledge, tick: number): boolean {
  const seenAt = knowledge.hostileAircraftSeenAt;
  return seenAt !== null && tick - seenAt < self.doctrine.airCoverSeconds;
}

function casualtyFraction(self: UnitSelf): number {
  return 1 - self.personnel / self.initialPersonnel;
}

function inArea(position: Vec2, area: Area): boolean {
  return distance(position, area.center) <= area.radius;
}

function expectsSupport(knowledge: UnitKnowledge, tick: number): boolean {
  return knowledge.expectedSupport !== null && tick <= knowledge.expectedSupport.lapsesAt;
}

function nextMode(self: UnitSelf, knowledge: UnitKnowledge, tick: number): GroundMode {
  const { doctrine } = self;
  // A unit expecting air support accepts more risk before giving up its position.
  const relief = expectsSupport(knowledge, tick) ? doctrine.supportHoldBonus : 0;
  const atRisk =
    casualtyFraction(self) >= doctrine.withdrawCasualties + (1 - doctrine.withdrawCasualties) * relief ||
    self.morale <= doctrine.withdrawMorale * (1 - relief) ||
    self.suppression >= doctrine.withdrawSuppression ||
    self.ammunition <= 0;

  switch (self.mode) {
    case 'steady':
      return atRisk ? 'withdrawing' : 'steady';
    case 'withdrawing':
      return inArea(self.position, self.fallback) ? 'recovering' : 'withdrawing';
    case 'recovering': {
      const spent =
        self.returnsUsed >= doctrine.maxReturns ||
        casualtyFraction(self) > doctrine.returnMaxCasualties ||
        self.ammunition < self.initialAmmunition * doctrine.returnMinAmmoFraction;
      if (spent) return 'broken';
      const recovered =
        self.morale >= doctrine.returnMorale && self.suppression <= doctrine.returnSuppression;
      return recovered ? 'steady' : 'recovering';
    }
    case 'broken':
      return 'broken';
  }
}

function nextPatrolIndex(self: UnitSelf): number {
  if (self.objective.kind !== 'PatrolArea') return self.patrolIndex;
  const { waypoints } = self.objective;
  const waypoint = waypoints[self.patrolIndex % waypoints.length];
  if (waypoint === undefined || distance(self.position, waypoint) > 25) return self.patrolIndex;
  return (self.patrolIndex + 1) % waypoints.length;
}

/** Nearest identified hostile the unit itself tracks, breaking ties by contact ID. */
function chooseTarget(self: UnitSelf, knowledge: UnitKnowledge, tick: number): ContactEstimate | null {
  let best: ContactEstimate | null = null;
  let bestRange = Number.POSITIVE_INFINITY;
  for (const id of Object.keys(knowledge.contacts).sort()) {
    const contact = knowledge.contacts[id];
    if (contact === undefined || contact.identification !== 'hostile') continue;
    if (tick - contact.position.observedAt > ENGAGE_MEMORY_TICKS) continue;
    const range = distance(self.position, contact.position.center);
    if (range <= self.doctrine.engageRangeMeters && range < bestRange) {
      best = contact;
      bestRange = range;
    }
  }
  return best;
}

function engage(self: UnitSelf, target: ContactEstimate): GroundIntent {
  const { closesToMeters, pinnedSuppression } = self.doctrine;
  const closes =
    closesToMeters !== null &&
    self.suppression < pinnedSuppression &&
    distance(self.position, target.position.center) > closesToMeters;
  return { kind: 'engage', contactId: target.contactId, closeTo: closes ? target.position.center : null };
}

/** Strongest current report of hostiles within `radius` of a point. */
function reportedThreat(
  self: UnitSelf,
  knowledge: UnitKnowledge,
  point: Vec2,
  radius: number,
  tick: number,
): ContactEstimate | null {
  let worst: ContactEstimate | null = null;
  for (const key of Object.keys(knowledge.reports).sort()) {
    const report = knowledge.reports[key];
    if (report === undefined || report.identification !== 'hostile') continue;
    if (tick - report.position.observedAt > self.doctrine.reportMemorySeconds) continue;
    if (distance(point, report.position.center) > radius) continue;
    if (worst === null || strengthMidpoint(report.strength) > strengthMidpoint(worst.strength)) worst = report;
  }
  return worst;
}

function strengthRatio(self: UnitSelf, report: ContactEstimate): number {
  return strengthMidpoint(report.strength) / self.personnel;
}

function pointAway(from: Vec2, threat: Vec2, meters: number): Vec2 {
  const gap = distance(from, threat);
  if (gap === 0) return from;
  return { x: from.x + ((from.x - threat.x) / gap) * meters, y: from.y + ((from.y - threat.y) / gap) * meters };
}

function pointToward(from: Vec2, threat: Vec2, meters: number): Vec2 {
  return pointAway(from, threat, -Math.min(meters, distance(from, threat)));
}

function withdrawalPoint(self: UnitSelf, knowledge: UnitKnowledge, tick: number): Vec2 {
  const { center, radius } = self.fallback;
  const threat = reportedThreat(self, knowledge, center, self.doctrine.alertRadiusMeters, tick);
  return threat === null ? center : pointAway(center, threat.position.center, radius * 0.9);
}

function holdArea(self: UnitSelf, knowledge: UnitKnowledge, area: Area, tick: number): GroundIntent {
  const threat = reportedThreat(self, knowledge, area.center, self.doctrine.alertRadiusMeters, tick);
  if (threat !== null) {
    const facing = pointToward(area.center, threat.position.center, area.radius * 0.7);
    if (distance(self.position, facing) > REPOSITION_ARRIVED_METERS) return { kind: 'move', destination: facing };
    return { kind: 'hold', posture: 'defending' };
  }
  return inArea(self.position, area)
    ? { kind: 'hold', posture: 'defending' }
    : { kind: 'move', destination: area.center };
}

function advance(self: UnitSelf, knowledge: UnitKnowledge, area: Area, tick: number): GroundIntent {
  if (inArea(self.position, area)) return { kind: 'hold', posture: 'defending' };
  const threat = reportedThreat(self, knowledge, self.position, self.doctrine.alertRadiusMeters, tick);
  if (threat !== null && strengthRatio(self, threat) >= self.doctrine.delayStrengthRatio) {
    return { kind: 'hold', posture: 'prone' };
  }
  return { kind: 'move', destination: area.center };
}

function patrol(self: UnitSelf, knowledge: UnitKnowledge, waypoint: Vec2 | undefined, tick: number): GroundIntent {
  const threat = reportedThreat(self, knowledge, self.position, self.doctrine.alertRadiusMeters, tick);
  if (threat !== null) {
    return strengthRatio(self, threat) >= self.doctrine.avoidStrengthRatio
      ? { kind: 'move', destination: self.fallback.center }
      : { kind: 'move', destination: threat.position.center };
  }
  return waypoint === undefined ? { kind: 'hold', posture: 'defending' } : { kind: 'move', destination: waypoint };
}

function pursueObjective(
  self: UnitSelf,
  knowledge: UnitKnowledge,
  patrolIndex: number,
  tick: number,
): GroundIntent {
  const { objective } = self;
  switch (objective.kind) {
    case 'HoldArea':
      return holdArea(self, knowledge, objective.area, tick);
    case 'MoveTo':
    case 'WithdrawTo':
      return advance(self, knowledge, objective.area, tick);
    case 'PatrolArea':
      return patrol(self, knowledge, objective.waypoints[patrolIndex % objective.waypoints.length], tick);
  }
}
