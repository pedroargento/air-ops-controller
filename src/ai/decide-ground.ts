import { hypot } from '../domain/public/det-math';
import { airHitChance } from '../domain/public/equipment';
import { strengthMidpoint, type ContactEstimate } from '../domain/public/estimates';
import { distance, type Vec2 } from '../domain/public/geometry';
import type {
  Area,
  GroundBehavior,
  GroundDecision,
  GroundIntent,
  GroundMode,
  UnitKnowledge,
  UnitSelf,
} from '../domain/public/ground';

const ENGAGE_MEMORY_TICKS = 20;
const REPOSITION_ARRIVED_METERS = 25;
const BREAK_CONTACT_METERS = 300;
const LOW_AMMUNITION_FRACTION = 0.25;
const NO_SUPPORT_WEAPONS_ASSAULT_FACTOR = 0.6;
const AIRCRAFT_MEMORY_TICKS = 10;

/** Fire rate per behavior, supplied by the scenario so that it stays tunable. */
export type BehaviorFireRates = Readonly<Record<GroundBehavior, number>>;

// The same function drives both sides. It reads only the unit's own state and
// its beliefs; faction never appears in a branch.
export function decideGround(
  self: UnitSelf,
  knowledge: UnitKnowledge,
  tick: number,
  rates: BehaviorFireRates,
): GroundDecision {
  const mode = nextMode(self, knowledge, tick);
  const returnsUsed = mode === 'steady' && self.mode === 'recovering' ? self.returnsUsed + 1 : self.returnsUsed;
  const patrolIndex = nextPatrolIndex(self);
  const decision = (intent: GroundIntent, behavior: GroundBehavior | null): GroundDecision => ({
    intent,
    mode,
    behavior,
    behaviorSinceTick: behavior === self.behavior ? self.behaviorSinceTick : tick,
    firesAtAircraft: mode !== 'broken' && firesAtAircraft(self, knowledge, tick),
    returnsUsed,
    patrolIndex,
  });

  const target = chooseTarget(self, knowledge, tick);
  if (mode === 'withdrawing') {
    const destination = withdrawalPoint(self, knowledge, tick);
    return decision(returnFire(self, target, destination, rates) ?? { kind: 'move', destination }, 'disengage');
  }
  if (mode === 'recovering') {
    return decision(returnFire(self, target, null, rates) ?? { kind: 'hold', posture: 'defending' }, 'disengage');
  }
  if (mode === 'broken') return decision({ kind: 'hold', posture: 'defending' }, 'disengage');

  if (target !== null && self.ammunition > 0) {
    const behavior = chooseBehavior(self, knowledge, target, tick);
    return decision(actOn(behavior, self, knowledge, target, patrolIndex, tick, rates), behavior);
  }
  if (self.suppression >= self.doctrine.pinnedSuppression) {
    return decision({ kind: 'hold', posture: 'prone' }, null);
  }
  if (takingAirCover(self, knowledge, tick)) return decision({ kind: 'hold', posture: 'prone' }, null);
  return decision(pursueObjective(self, knowledge, patrolIndex, tick), null);
}

/**
 * A unit opens fire only if its best chance is worth giving away its position; the
 * doctrine sets that price. A unit with no useful weapon therefore stays concealed.
 */
function firesAtAircraft(self: UnitSelf, knowledge: UnitKnowledge, tick: number): boolean {
  const seen = knowledge.noticedAircraft;
  if (seen === null || tick - seen.seenAt > AIRCRAFT_MEMORY_TICKS) return false;
  if (self.suppression >= self.doctrine.pinnedSuppression) return false;
  const gap = distance(self.position, seen.position);
  const slant = hypot(gap, seen.altitudeMeters);
  const best = Math.max(0, ...self.airWeapons.map((weapon) => airHitChance(weapon, slant, seen.altitudeMeters)));
  return best > 0 && best >= self.doctrine.airFireThreshold;
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
    if (range <= self.doctrine.detectRangeMeters && range < bestRange) {
      best = contact;
      bestRange = range;
    }
  }
  return best;
}

function rangeTo(self: UnitSelf, target: ContactEstimate): number {
  return distance(self.position, target.position.center);
}

/** Enemy strength over own, from what the unit sees and what it has been told. */
function perceivedRatio(self: UnitSelf, knowledge: UnitKnowledge, target: ContactEstimate, tick: number): number {
  const seen = strengthMidpoint(target.strength);
  const reported = reportedThreat(self, knowledge, target.position.center, self.doctrine.alertRadiusMeters, tick);
  const told = reported === null ? 0 : strengthMidpoint(reported.strength);
  return Math.max(seen, told) / Math.max(1, self.personnel);
}

/** A unit can't give ground it holds, or the fallback it has come back to reinforce. */
function mustDefend(self: UnitSelf, target: ContactEstimate): boolean {
  const reaches = ({ center, radius }: Area): boolean =>
    distance(target.position.center, center) <= radius + self.doctrine.standoffMeters;
  if (self.objective.kind === 'HoldArea' && reaches(self.objective.area)) return true;
  return inArea(self.position, self.fallback) && reaches(self.fallback);
}

function scoreBehaviors(
  self: UnitSelf,
  knowledge: UnitKnowledge,
  target: ContactEstimate,
  tick: number,
): readonly (readonly [GroundBehavior, number])[] {
  const { doctrine } = self;
  const ratio = perceivedRatio(self, knowledge, target, tick);
  const ammunition = Math.min(1, self.ammunition / (self.initialAmmunition * LOW_AMMUNITION_FRACTION));
  const support = expectsSupport(knowledge, tick) ? 1 + doctrine.supportHoldBonus : 1;
  const uncertain = target.strength.kind === 'unknown' || target.confidence === 'low' ? 1 : 0.4;
  // A unit weighs what it can actually do: without heavy weapons it is a poor assault element.
  const firepower = self.supportWeapons > 0 ? 1 : NO_SUPPORT_WEAPONS_ASSAULT_FACTOR;
  return [
    ['assault', doctrine.assaultBias * self.morale * ammunition * support * firepower * Math.min(1.5, 1 / ratio)],
    ['harass', doctrine.harassBias * ammunition * (1 + self.groundCover)],
    ['probe', doctrine.probeBias * ammunition * uncertain],
    ['observe', doctrine.observeBias * (0.5 + Math.min(ratio, 2) / 2)],
  ];
}

function chooseBehavior(
  self: UnitSelf,
  knowledge: UnitKnowledge,
  target: ContactEstimate,
  tick: number,
): GroundBehavior {
  if (mustDefend(self, target)) return 'assault';
  const held = tick - self.behaviorSinceTick;
  const { burstSeconds, pauseSeconds } = self.doctrine;
  if (self.behavior === 'assault') return 'assault';
  if ((self.behavior === 'probe' || self.behavior === 'harass') && held < burstSeconds) return self.behavior;
  // A burst ends in a pause, so that contact stays intermittent.
  if (self.behavior === 'probe' || self.behavior === 'harass') return 'observe';
  if (self.behavior === 'observe' && held < pauseSeconds) return 'observe';
  let best: GroundBehavior = 'observe';
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const [behavior, score] of scoreBehaviors(self, knowledge, target, tick)) {
    if (score > bestScore) {
      best = behavior;
      bestScore = score;
    }
  }
  return best;
}

/** A holding unit told what is coming has had time to prepare its positions. */
function isForewarned(self: UnitSelf, knowledge: UnitKnowledge, tick: number): boolean {
  const { objective, doctrine } = self;
  if (objective.kind !== 'HoldArea') return false;
  return reportedThreat(self, knowledge, objective.area.center, doctrine.alertRadiusMeters, tick) !== null;
}

function returnFire(
  self: UnitSelf,
  target: ContactEstimate | null,
  moveTo: Vec2 | null,
  rates: BehaviorFireRates,
): GroundIntent | null {
  if (target === null || !self.underFire || self.ammunition <= 0) return null;
  if (rangeTo(self, target) > self.doctrine.engageRangeMeters) return null;
  return { kind: 'engage', contactId: target.contactId, closeTo: moveTo, fireRate: rates.disengage, prepared: false };
}

function actOn(
  behavior: GroundBehavior,
  self: UnitSelf,
  knowledge: UnitKnowledge,
  target: ContactEstimate,
  patrolIndex: number,
  tick: number,
  rates: BehaviorFireRates,
): GroundIntent {
  const { engageRangeMeters, closesToMeters, pinnedSuppression, standoffMeters } = self.doctrine;
  const range = rangeTo(self, target);
  const pinned = self.suppression >= pinnedSuppression || takingAirCover(self, knowledge, tick);
  const engageAt = (closeTo: Vec2 | null, fireRate: number): GroundIntent => ({
    kind: 'engage',
    contactId: target.contactId,
    closeTo: pinned ? null : closeTo,
    fireRate,
    prepared: isForewarned(self, knowledge, tick),
  });

  switch (behavior) {
    case 'assault': {
      const closes = closesToMeters !== null && range > closesToMeters;
      return engageAt(closes ? target.position.center : null, rates.assault);
    }
    case 'probe':
    case 'harass':
      return engageAt(range > engageRangeMeters ? target.position.center : null, rates[behavior]);
    case 'observe': {
      const tooClose = range < standoffMeters && self.objective.kind !== 'HoldArea';
      const away = pointAway(self.position, target.position.center, BREAK_CONTACT_METERS);
      if (self.underFire && range <= engageRangeMeters) {
        return engageAt(tooClose ? away : null, rates.observe);
      }
      if (tooClose) return { kind: 'move', destination: away };
      if (self.objective.kind === 'HoldArea') return pursueObjective(self, knowledge, patrolIndex, tick);
      return { kind: 'hold', posture: 'prone' };
    }
    case 'disengage':
      return { kind: 'move', destination: withdrawalPoint(self, knowledge, tick) };
  }
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
    // Warned of a stronger force, a patrol reinforces its fallback instead of being caught alone.
    if (strengthRatio(self, threat) >= self.doctrine.avoidStrengthRatio) {
      return inArea(self.position, self.fallback)
        ? { kind: 'hold', posture: 'defending' }
        : { kind: 'move', destination: self.fallback.center };
    }
    // Investigating means getting a look at it, not walking into it.
    const point = threat.position.center;
    const gap = distance(self.position, point);
    return gap > self.doctrine.standoffMeters
      ? { kind: 'move', destination: pointToward(self.position, point, gap - self.doctrine.standoffMeters) }
      : { kind: 'hold', posture: 'prone' };
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
