import { hypot } from '../domain/public/det-math';
import { airHitChance } from '../domain/public/equipment';
import { strengthMidpoint, type ContactEstimate } from '../domain/public/estimates';
import { holdsGround } from '../domain/public/ground';
import { groupStrength } from './contact-groups';
import { ambushSprung, nextDrill } from './drills';
import { distance, type Vec2 } from '../domain/public/geometry';
import type {
  Area,
  Drill,
  DrillMap,
  GroundBehavior,
  GroundDecision,
  GroundIntent,
  GroundMode,
  PlatoonDecision,
  SquadRole,
  UnitKnowledge,
  UnitSelf,
} from '../domain/public/ground';

const ENGAGE_MEMORY_TICKS = 20;

/** Roles that fire on a position even with nobody seen there. */
const SUPPRESSES: ReadonlySet<SquadRole> = new Set(['support']);
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
  map: DrillMap,
): GroundDecision {
  const { mode } = self;
  const lying = self.objective.kind === 'AmbushArea' && !self.ambushSprung;
  const patrolIndex = nextPatrolIndex(self);
  const decision = (intent: GroundIntent, behavior: GroundBehavior | null, avoid: Area | null = null, viaDone = false): GroundDecision => ({
    intent,
    behavior,
    behaviorSinceTick: behavior === self.behavior ? self.behaviorSinceTick : tick,
    firesAtAircraft: mode !== 'broken' && !lying && firesAtAircraft(self, knowledge, tick),
    patrolIndex,
    viaDone,
    avoid,
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

  if (self.drill !== null && self.role !== null) {
    const { intent, viaDone } = runDrill(self, self.drill, self.role, target, rates, map);
    return decision(intent, intent.kind === 'engage' ? 'assault' : null, drillAvoid(self, viaDone), viaDone);
  }
  if (self.objective.kind === 'AmbushArea' && lying) return decision(lieInWait(self, self.objective.area), null);

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


const canAnswerPosition = ({ objective, doctrine }: UnitSelf): boolean =>
  objective.kind !== 'WithdrawTo' && (doctrine.drills.includes('attack') || doctrine.drills.includes('bypass'));

function casualtyFraction(self: UnitSelf): number {
  return 1 - self.personnel / self.initialPersonnel;
}

function inArea(position: Vec2, area: Area): boolean {
  return distance(position, area.center) <= area.radius;
}

function expectsSupport(knowledge: UnitKnowledge, tick: number): boolean {
  return knowledge.expectedSupport !== null && tick <= knowledge.expectedSupport.lapsesAt;
}

/** The whole platoon's decision, made from its totals so that squads go together (§4.0.1). */
export function decidePlatoon(platoon: UnitSelf, knowledge: UnitKnowledge, tick: number, map: DrillMap): PlatoonDecision {
  const mode = nextMode(platoon, knowledge, tick);
  const returned = mode === 'steady' && platoon.mode === 'recovering';
  const { objective } = platoon;
  const step = nextDrill({ ...platoon, mode }, knowledge, tick, map);
  const openFire =
    objective.kind === 'AmbushArea'
      ? objective.openFireMeters
      : step.drill?.kind === 'hastyAmbush'
        ? platoon.doctrine.nearAmbushMeters
        : null;
  const cleared = objective.kind === 'AssaultArea' && step.finished?.kind === 'attack';
  const arrived = objective.kind === 'MoveTo' && inArea(platoon.position, objective.area);
  return {
    mode,
    returnsUsed: platoon.returnsUsed + (returned ? 1 : 0),
    drill: step.drill,
    handled: step.handled,
    ambushSprung: openFire !== null && ambushSprung(platoon, knowledge, openFire, tick),
    fallback: mode === 'withdrawing' && platoon.mode === 'steady' ? rallyPoint(platoon, knowledge, tick) : platoon.fallback,
    objectiveDone: cleared || arrived,
  };
}

/** A platoon on the move pulls back only as far as it must, then carries on. */
function rallyPoint(self: UnitSelf, knowledge: UnitKnowledge, tick: number): Area {
  const { rallyMeters } = self.doctrine;
  if (rallyMeters === null || holdsGround(self.objective)) return self.fallback;
  const threat = chooseTarget(self, knowledge, tick);
  if (threat === null) return self.fallback;
  const center = pointAway(self.position, threat.position.center, rallyMeters);
  return { center, radius: self.fallback.radius };
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
  const seen = groupStrength(knowledge, target, self.doctrine.groupRadiusMeters);
  const reported = reportedThreat(self, knowledge, target.position.center, self.doctrine.alertRadiusMeters, tick);
  const told = reported === null ? 0 : strengthMidpoint(reported.strength);
  return Math.max(seen, told) / Math.max(1, self.platoonPersonnel);
}

/** A unit can't give ground it holds, or the fallback it has come back to reinforce. */
function mustDefend(self: UnitSelf, target: ContactEstimate): boolean {
  const reaches = ({ center, radius }: Area): boolean =>
    distance(target.position.center, center) <= radius + self.doctrine.standoffMeters;
  if (holdsGround(self.objective) && reaches(self.objective.area)) return true;
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
  const ammunition = Math.min(1, self.ammunition / (self.initialAmmunition * self.doctrine.assaultAmmunitionFraction));
  const support = expectsSupport(knowledge, tick) ? 1 + doctrine.supportHoldBonus : 1;
  const uncertain = target.strength.kind === 'unknown' || target.confidence === 'low' ? 1 : 0.4;
  // A unit weighs what it can actually do: without heavy weapons it is a poor assault element.
  const firepower = self.supportWeapons > 0 ? 1 : self.doctrine.noSupportWeaponsAssaultFactor;
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
  if (!holdsGround(objective)) return false;
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
  return { kind: 'engage', aim: target.position.center, closeTo: moveTo, fireRate: rates.disengage, prepared: false };
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
    aim: target.position.center,
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
      const tooClose = range < standoffMeters && !holdsGround(self.objective);
      const away = pointAway(self.position, target.position.center, self.doctrine.breakContactMeters);
      if (self.underFire && range <= engageRangeMeters) {
        return engageAt(tooClose ? away : null, rates.observe);
      }
      if (tooClose) return { kind: 'move', destination: away };
      if (holdsGround(self.objective)) return pursueObjective(self, knowledge, patrolIndex, tick);
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
  let worstKey = '';
  for (const [key, report] of Object.entries(knowledge.reports)) {
    if (report.identification !== 'hostile') continue;
    if (tick - report.position.observedAt > self.doctrine.reportMemorySeconds) continue;
    if (distance(point, report.position.center) > radius) continue;
    const gain = worst === null ? 1 : strengthMidpoint(report.strength) - strengthMidpoint(worst.strength);
    if (gain > 0 || (gain === 0 && key < worstKey)) {
      worst = report;
      worstKey = key;
    }
  }
  return worst;
}

function strengthRatio(self: UnitSelf, report: ContactEstimate): number {
  return strengthMidpoint(report.strength) / Math.max(1, self.platoonPersonnel);
}

function pointAway(from: Vec2, threat: Vec2, meters: number): Vec2 {
  const gap = distance(from, threat);
  if (gap === 0) return from;
  return { x: from.x + ((from.x - threat.x) / gap) * meters, y: from.y + ((from.y - threat.y) / gap) * meters };
}

function pointToward(from: Vec2, threat: Vec2, meters: number): Vec2 {
  return pointAway(from, threat, -Math.min(meters, distance(from, threat)));
}

/** A squad's own place around a point, so a platoon doesn't stack on one spot. */
function slotted(self: UnitSelf, point: Vec2, radius: number): Vec2 {
  return { x: point.x + self.slot.x * radius, y: point.y + self.slot.y * radius };
}

function withdrawalPoint(self: UnitSelf, knowledge: UnitKnowledge, tick: number): Vec2 {
  const { center, radius } = self.fallback;
  const threat = reportedThreat(self, knowledge, center, self.doctrine.alertRadiusMeters, tick);
  const base = threat === null ? center : pointAway(center, threat.position.center, radius * 0.9);
  return slotted(self, base, radius * 0.3);
}

function holdArea(self: UnitSelf, knowledge: UnitKnowledge, area: Area, tick: number): GroundIntent {
  const threat = reportedThreat(self, knowledge, area.center, self.doctrine.alertRadiusMeters, tick);
  if (threat !== null) {
    const facing = slotted(self, pointToward(area.center, threat.position.center, area.radius * 0.7), area.radius * 0.3);
    if (distance(self.position, facing) > self.doctrine.arrivedMeters) return { kind: 'move', destination: facing };
    return { kind: 'hold', posture: 'defending' };
  }
  const post = slotted(self, area.center, area.radius);
  return distance(self.position, post) <= self.doctrine.arrivedMeters
    ? { kind: 'hold', posture: 'defending' }
    : { kind: 'move', destination: post };
}

function advance(self: UnitSelf, knowledge: UnitKnowledge, area: Area, tick: number): GroundIntent {
  if (inArea(self.position, area)) return { kind: 'hold', posture: 'defending' };
  // A platoon with the drills for it answers a reported position (§4.0.2); others wait it out.
  const threat = reportedThreat(self, knowledge, self.position, self.doctrine.alertRadiusMeters, tick);
  if (!canAnswerPosition(self) && threat !== null && strengthRatio(self, threat) >= self.doctrine.delayStrengthRatio) {
    return { kind: 'hold', posture: 'prone' };
  }
  return { kind: 'move', destination: slotted(self, area.center, area.radius) };
}

function patrol(self: UnitSelf, knowledge: UnitKnowledge, waypoint: Vec2 | undefined, tick: number): GroundIntent {
  const threat = reportedThreat(self, knowledge, self.position, self.doctrine.alertRadiusMeters, tick);
  if (threat !== null) {
    // Warned of a stronger force, a patrol reinforces its fallback instead of being caught alone.
    if (strengthRatio(self, threat) >= self.doctrine.avoidStrengthRatio) {
      return inArea(self.position, self.fallback)
        ? { kind: 'hold', posture: 'defending' }
        : { kind: 'move', destination: slotted(self, self.fallback.center, self.fallback.radius) };
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
    case 'AmbushArea':
      return holdArea(self, knowledge, objective.area, tick);
    case 'MoveTo':
    case 'WithdrawTo':
    case 'AssaultArea':
      return advance(self, knowledge, objective.area, tick);
    case 'PatrolArea':
      return patrol(self, knowledge, objective.waypoints[patrolIndex % objective.waypoints.length], tick);
  }
}

/** Moves to its place on the ambush, then hides. */
function lieInWait(self: UnitSelf, area: Area): GroundIntent {
  const post = slotted(self, area.center, area.radius);
  return distance(self.position, post) <= self.doctrine.arrivedMeters
    ? { kind: 'hold', posture: 'hidden' }
    : { kind: 'move', destination: post };
}

function objectivePoint(self: UnitSelf): Vec2 | null {
  const { objective } = self;
  return 'area' in objective ? slotted(self, objective.area.center, objective.area.radius) : null;
}

const drillAvoid = (self: UnitSelf, viaDone: boolean): Area | null =>
  self.role === 'bypass' || (self.role === 'maneuver' && !viaDone) ? (self.drill?.avoid ?? null) : null;

type DrillAct = Readonly<{ intent: GroundIntent; viaDone: boolean }>;

/** What this squad's role asks of it (§4.0.2). */
function runDrill(
  self: UnitSelf,
  drill: Drill,
  role: SquadRole,
  target: ContactEstimate | null,
  rates: BehaviorFireRates,
  map: DrillMap,
): DrillAct {
  const { doctrine } = self;
  const pinned = self.suppression >= doctrine.pinnedSuppression;
  const stay: GroundIntent = { kind: 'hold', posture: 'prone' };
  // Pinned or out of rounds, a squad goes nowhere: it can't carry the drill forward.
  const go = (destination: Vec2): GroundIntent =>
    pinned || self.ammunition <= 0 ? stay : { kind: 'move', destination };
  // Fire goes at a place: the enemy as this platoon sees it, or, with nobody in view,
  // the position the drill is about, which support can still suppress.
  const point = target?.position.center ?? (SUPPRESSES.has(role) ? drill.target : null);
  const inReach =
    point !== null &&
    self.ammunition > 0 &&
    distance(self.position, point) <= doctrine.engageRangeMeters &&
    map.sees(self.position, point);
  const fire = (closeTo: Vec2 | null, fireRate: number, prepared = false): GroundIntent =>
    point === null
      ? stay
      : { kind: 'engage', aim: point, closeTo: pinned ? null : closeTo, fireRate: target === null ? rates.harass : fireRate, prepared };
  const close = (): GroundIntent => {
    const aim = point ?? slotted(self, drill.target, drill.radius);
    const stopAt = doctrine.closesToMeters ?? self.doctrine.arrivedMeters;
    if (inReach) return fire(distance(self.position, aim) > stopAt ? aim : null, rates.assault);
    return distance(self.position, aim) > self.doctrine.arrivedMeters ? go(aim) : { kind: 'hold', posture: 'defending' };
  };

  switch (role) {
    case 'assault':
      return { intent: close(), viaDone: false };
    case 'support': {
      if (inReach) return { intent: fire(null, rates.assault), viaDone: false };
      const gap = distance(self.position, drill.target);
      const standoff = doctrine.engageRangeMeters * 0.8;
      if (gap > standoff) return { intent: go(pointToward(self.position, drill.target, gap - standoff)), viaDone: false };
      // In range but no view: it has to move to be any use.
      const blocked = target !== null && self.ammunition > 0;
      return { intent: blocked ? go(pointToward(self.position, drill.target, self.doctrine.sidestepMeters)) : stay, viaDone: false };
    }
    case 'maneuver': {
      const { via } = drill;
      const viaDone = self.viaDone || via === null || distance(self.position, via) <= self.doctrine.arrivedMeters * 2;
      if (viaDone) return { intent: close(), viaDone: true };
      return { intent: inReach && self.underFire ? fire(via, rates.disengage) : go(via), viaDone: false };
    }
    case 'cover':
      return { intent: inReach ? fire(null, rates.assault, true) : stay, viaDone: false };
    case 'bypass': {
      const onward = objectivePoint(self) ?? drill.target;
      return { intent: inReach && self.underFire ? fire(onward, rates.disengage) : go(onward), viaDone: false };
    }
    case 'ambush':
      if (self.ambushSprung && inReach) return { intent: fire(null, rates.assault), viaDone: false };
      return { intent: { kind: 'hold', posture: 'hidden' }, viaDone: false };
    case 'hold':
      return { intent: inReach && self.underFire ? fire(null, rates.observe, true) : stay, viaDone: false };
  }
}
