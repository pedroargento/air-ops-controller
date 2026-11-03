import { strengthMidpoint, type ContactEstimate } from '../domain/public/estimates';
import { cos, sin } from '../domain/public/det-math';
import { distance, type Vec2 } from '../domain/public/geometry';
import { POI_KINDS, type Poi } from '../domain/public/poi';
import { AIR_OPS } from '../domain/public/radio';
import type {
  Area,
  Drill,
  DrillKind,
  DrillMap,
  GroundObjective,
  HandledPosition,
  SquadRole,
  UnitKnowledge,
  UnitSelf,
} from '../domain/public/ground';

type EndCondition = 'enemyGone' | 'areaClear' | 'passed' | 'supportArrived';

export type DrillDefinition = Readonly<{
  /** The squads nearest the enemy, by the doctrine's `supportShare`. */
  lead: SquadRole;
  rest: SquadRole;
  /** A platoon of one squad has nobody to pin or flank for it. */
  solo: SquadRole;
  /** Squads needed to send some wide: under fire, a small platoon can't spare them. */
  flankFrom: number;
  ends: EndCondition;
}>;

// The drills themselves (§4.0.2). Their numbers come from doctrine.
export const DRILLS: Readonly<Record<DrillKind, DrillDefinition>> = {
  nearAmbush: { lead: 'assault', rest: 'assault', solo: 'assault', flankFrom: 2, ends: 'enemyGone' },
  farAmbush: { lead: 'support', rest: 'maneuver', solo: 'cover', flankFrom: 3, ends: 'enemyGone' },
  attack: { lead: 'support', rest: 'maneuver', solo: 'assault', flankFrom: 2, ends: 'areaClear' },
  bypass: { lead: 'bypass', rest: 'bypass', solo: 'bypass', flankFrom: 2, ends: 'passed' },
  hastyAmbush: { lead: 'ambush', rest: 'ambush', solo: 'ambush', flankFrom: 2, ends: 'enemyGone' },
  waitForAir: { lead: 'hold', rest: 'hold', solo: 'hold', flankFrom: 2, ends: 'supportArrived' },
  pushThrough: { lead: 'bypass', rest: 'bypass', solo: 'bypass', flankFrom: 2, ends: 'passed' },
};

const ROUTE_STEP = 3;

const knows = (self: UnitSelf, kind: DrillKind): boolean => self.doctrine.drills.includes(kind);

/** Hostiles the platoon believes in: its own tracks and what it has been told. */
function knownHostiles(self: UnitSelf, knowledge: UnitKnowledge, tick: number): readonly ContactEstimate[] {
  const own = Object.values(knowledge.contacts).filter(
    (contact) => contact.identification === 'hostile' && tick - contact.position.observedAt <= self.doctrine.clearSeconds,
  );
  const told = Object.values(knowledge.reports).filter(
    (report) => report.identification === 'hostile' && tick - report.position.observedAt <= self.doctrine.reportMemorySeconds,
  );
  const marked = Object.values(knowledge.pois)
    .filter((poi) => POI_KINDS[poi.kind].effect === 'suspectedEnemy')
    .map(suspectedEnemy);
  return [...own, ...told, ...marked];
}

/** A mark as the platoon holds it: an enemy of unknown strength, on someone's say-so. */
function suspectedEnemy(poi: Poi): ContactEstimate {
  return {
    contactId: `poi/${poi.id}` as ContactEstimate['contactId'],
    provenance: { sourceId: AIR_OPS, observedAt: poi.placedAt },
    identification: 'hostile',
    position: { center: poi.center, sigmaMeters: poi.radiusMeters, headingRad: null, speedMps: null, observedAt: poi.placedAt },
    strength: { kind: 'unknown' },
    kind: 'unknown',
    activity: 'stationary',
    confidence: 'low',
    observedWeapons: [],
  };
}

/**
 * Headcount believed around a point. Its own squads and what it was told are two looks at
 * one enemy, so they don't add up, and a grouped report already includes its neighbours.
 */
function strengthAround(self: UnitSelf, known: readonly ContactEstimate[], point: Vec2): number {
  const near = known.filter((contact) => distance(contact.position.center, point) <= self.doctrine.groupRadiusMeters);
  const fromPlatoon = (contact: ContactEstimate): boolean => contact.provenance.sourceId === self.id;
  const add = (contacts: readonly ContactEstimate[]): number => {
    const strongest = new Map<string, number>();
    for (const contact of contacts) {
      const strength = strengthMidpoint(contact.strength);
      strongest.set(contact.contactId, Math.max(strongest.get(contact.contactId) ?? 0, strength));
    }
    return [...strongest.values()].reduce((sum, strength) => sum + strength, 0);
  };
  const told = near.filter((contact) => !fromPlatoon(contact));
  const grouped = told.filter((contact) => contact.grouped === true).map((contact) => strengthMidpoint(contact.strength));
  return Math.max(add(near.filter(fromPlatoon)), add(told.filter((contact) => contact.grouped !== true)), ...grouped);
}

function isHandled(self: UnitSelf, point: Vec2): boolean {
  const radius = self.doctrine.groupRadiusMeters;
  return self.handled.some(({ center, askedAir }) => askedAir !== true && distance(center, point) <= radius);
}

function askedAirAbout(self: UnitSelf, point: Vec2): boolean {
  const radius = self.doctrine.groupRadiusMeters;
  return self.handled.some(({ center, askedAir }) => askedAir === true && distance(center, point) <= radius);
}

function destinationOf(objective: GroundObjective): Vec2 | null {
  switch (objective.kind) {
    case 'MoveTo':
    case 'WithdrawTo':
    case 'AssaultArea':
      return objective.area.center;
    case 'PatrolArea':
    case 'HoldArea':
    case 'AmbushArea':
      return null;
  }
}

/** The nearest position on the way, from where the platoon's own route goes next. */
function threatOnRoute(self: UnitSelf, known: readonly ContactEstimate[]): ContactEstimate | null {
  const { warningMeters, corridorMeters } = self.doctrine;
  const route = self.routeAhead.filter((_, index) => index % ROUTE_STEP === 0);
  let best: ContactEstimate | null = null;
  let bestRange = Number.POSITIVE_INFINITY;
  for (const contact of known) {
    if (isHandled(self, contact.position.center)) continue;
    const range = distance(self.position, contact.position.center);
    if (range > warningMeters || range >= bestRange) continue;
    const onRoute = route.some(
      (point) =>
        distance(point, contact.position.center) <= corridorMeters && distance(self.position, point) <= warningMeters,
    );
    if (onRoute) {
      best = contact;
      bestRange = range;
    }
  }
  return best;
}

function comingTowards(self: UnitSelf, contact: ContactEstimate): boolean {
  if (contact.activity !== 'moving') return false;
  const { headingRad, center } = contact.position;
  if (headingRad === null) return false;
  const gap = distance(self.position, center);
  if (gap === 0) return true;
  const toward = ((self.position.x - center.x) * cos(headingRad) + (self.position.y - center.y) * sin(headingRad)) / gap;
  return toward >= self.doctrine.headingTowardsCos;
}

/** The side of the enemy it can't see and that has more cover. */
function flankPoint(self: UnitSelf, target: Vec2, map: DrillMap): Vec2 {
  const gap = Math.max(1, distance(self.position, target));
  const across = { x: -(target.y - self.position.y) / gap, y: (target.x - self.position.x) / gap };
  const { flankMeters } = self.doctrine;
  const point = (side: number): Vec2 => ({ x: target.x + across.x * side * flankMeters, y: target.y + across.y * side * flankMeters });
  const score = (candidate: Vec2): number => (map.sees(target, candidate) ? 0 : 1) + map.cover(candidate);
  const [left, right] = [point(1), point(-1)];
  return score(left) >= score(right) ? left : right;
}

const HOLDING_DRILLS: ReadonlySet<DrillKind> = new Set(['farAmbush', 'hastyAmbush']);

function drill(self: UnitSelf, kind: DrillKind, target: Vec2, tick: number, map: DrillMap, warned = false, radius = self.doctrine.attackRadiusMeters): Drill {
  const definition = DRILLS[kind];
  const flanks = definition.rest === 'maneuver' && self.squads >= definition.flankFrom;
  const avoid: Area = { center: target, radius: self.doctrine.flankMeters * 0.75 };
  return {
    kind,
    startedAt: tick,
    target,
    radius,
    via: flanks ? flankPoint(self, target, map) : null,
    avoid: flanks || kind === 'bypass' ? avoid : null,
    warned,
  };
}

/**
 * Air operations said this position is being suppressed now. The unit has only the
 * announcement to go on: it can't see whether the aircraft is really there.
 */
export function suppressedNow(self: UnitSelf, knowledge: UnitKnowledge, point: Vec2, tick: number): boolean {
  return Object.values(knowledge.suppressions).some(
    (entry) =>
      tick >= entry.fromTick &&
      tick <= entry.untilTick &&
      distance(entry.center, point) <= entry.radius + self.doctrine.groupRadiusMeters,
  );
}

/** Under someone else's suppression, the way through is to keep moving (§4.0.2). */
function pushThroughIfSuppressed(self: UnitSelf, knowledge: UnitKnowledge, target: Vec2, tick: number, map: DrillMap): Drill | null {
  // Once past it, the position is behind the platoon and there's nothing left to push through.
  const destination = destinationOf(self.objective);
  const past = destination !== null && distance(self.position, destination) < distance(target, destination);
  if (past || !knows(self, 'pushThrough')) return null;
  return suppressedNow(self, knowledge, target, tick) ? drill(self, 'pushThrough', target, tick, map, true) : null;
}

/**
 * Whether holding short for air is worth it, from what the platoon knows (§4.0.2). It waits
 * once per position, and only for a position too strong to take cheaply, with time to spare,
 * when air operations hasn't lately said no, and where the enemy can't see it waiting.
 * Otherwise it deals with the position itself.
 */
function worthWaiting(self: UnitSelf, knowledge: UnitKnowledge, target: Vec2, ratio: number, direct: number, tick: number, map: DrillMap): boolean {
  const { doctrine } = self;
  if (!self.canCallAir || !knows(self, 'waitForAir') || askedAirAbout(self, target)) return false;
  if (ratio < doctrine.waitForAirStrengthRatio) return false;
  if (self.secondsLeft < direct / doctrine.speedMps + doctrine.airWaitSeconds + doctrine.drillSeconds) return false;
  const refused = knowledge.supportRefusedAt;
  if (refused !== null && tick - refused < doctrine.airRefusedMemorySeconds) return false;
  return !map.sees(target, self.position);
}

/** What to do about a position on the route (§4.0.2). */
function answerPosition(
  self: UnitSelf,
  knowledge: UnitKnowledge,
  threat: ContactEstimate,
  known: readonly ContactEstimate[],
  tick: number,
  map: DrillMap,
): Drill | null {
  const { doctrine } = self;
  const target = threat.position.center;
  const pushed = pushThroughIfSuppressed(self, knowledge, target, tick, map);
  if (pushed !== null) return pushed;
  const destination = destinationOf(self.objective);
  const ratio = strengthAround(self, known, target) / Math.max(1, self.platoonPersonnel);
  const direct = destination === null ? 0 : map.routeMeters(self.position, destination, null);
  if (worthWaiting(self, knowledge, target, ratio, direct, tick, map)) return drill(self, 'waitForAir', target, tick, map, true);
  if (comingTowards(self, threat) && knows(self, 'hastyAmbush')) return drill(self, 'hastyAmbush', target, tick, map, true);

  const pressed = self.secondsLeft < direct / doctrine.speedMps + doctrine.drillSeconds;
  if ((ratio > doctrine.attackStrengthRatio || pressed) && destination !== null && knows(self, 'bypass')) {
    const avoid = { center: target, radius: doctrine.flankMeters * 0.75 };
    const around = map.routeMeters(self.position, destination, avoid);
    if (around <= direct * doctrine.maxDetourFactor) return drill(self, 'bypass', target, tick, map, true);
  }
  return knows(self, 'attack') ? drill(self, 'attack', target, tick, map, true) : null;
}

function nearestHostile(self: UnitSelf, knowledge: UnitKnowledge, tick: number): ContactEstimate | null {
  let best: ContactEstimate | null = null;
  let bestRange = Number.POSITIVE_INFINITY;
  for (const id of Object.keys(knowledge.contacts).sort()) {
    const contact = knowledge.contacts[id];
    if (contact === undefined || contact.identification !== 'hostile') continue;
    if (tick - contact.position.observedAt > self.doctrine.clearSeconds) continue;
    const range = distance(self.position, contact.position.center);
    if (range < bestRange) {
      best = contact;
      bestRange = range;
    }
  }
  return best;
}

function startDrill(self: UnitSelf, knowledge: UnitKnowledge, tick: number, map: DrillMap): Drill | null {
  const { objective, doctrine } = self;
  if (doctrine.drills.length === 0) return null;
  // Drills belong to a platoon going somewhere: holding and patrolling have their own rules.
  if (objective.kind !== 'MoveTo' && objective.kind !== 'AssaultArea') return null;
  const nearest = nearestHostile(self, knowledge, tick);
  if (self.underFire && nearest !== null) {
    const center = nearest.position.center;
    const range = distance(self.position, center);
    // Told the ambush is being suppressed, the way out of the kill zone is to keep going.
    const pushed = pushThroughIfSuppressed(self, knowledge, center, tick, map);
    if (pushed !== null) return pushed;
    if (range <= doctrine.nearAmbushMeters) return knows(self, 'nearAmbush') ? drill(self, 'nearAmbush', center, tick, map) : null;
    const known = knownHostiles(self, knowledge, tick);
    const strong = strengthAround(self, known, center) / Math.max(1, self.platoonPersonnel) > doctrine.attackStrengthRatio;
    if (strong && knows(self, 'bypass') && !isHandled(self, center)) return drill(self, 'bypass', center, tick, map);
    return knows(self, 'farAmbush') ? drill(self, 'farAmbush', center, tick, map) : null;
  }
  if (objective.kind === 'AssaultArea' && knows(self, 'attack')) {
    // Only an attack on the objective itself finishes it, not a fight that happened nearby.
    const { center, radius } = objective.area;
    const finished = self.handled.some((entry) => distance(entry.center, center) < 1);
    return finished ? null : drill(self, 'attack', center, tick, map, false, radius);
  }
  const known = knownHostiles(self, knowledge, tick);
  const threat = threatOnRoute(self, known);
  return threat === null ? null : answerPosition(self, knowledge, threat, known, tick, map);
}

function enemyStillThere(self: UnitSelf, knowledge: UnitKnowledge, active: Drill, reach: number, tick: number): boolean {
  return Object.values(knowledge.contacts).some(
    (contact) =>
      contact.identification === 'hostile' &&
      tick - contact.position.observedAt <= self.doctrine.clearSeconds &&
      distance(contact.position.center, active.target) <= reach,
  );
}

function goalMet(self: UnitSelf, knowledge: UnitKnowledge, active: Drill, tick: number): boolean {
  const { doctrine } = self;
  switch (DRILLS[active.kind].ends) {
    case 'enemyGone':
      return !self.underFire && tick - active.startedAt >= doctrine.clearSeconds &&
        !enemyStillThere(self, knowledge, active, doctrine.detectRangeMeters, tick);
    case 'areaClear': {
      const arrived = distance(self.position, active.target) <= active.radius + self.doctrine.objectiveMarginMeters;
      return arrived && !enemyStillThere(self, knowledge, active, active.radius + self.doctrine.objectiveMarginMeters, tick);
    }
    case 'passed': {
      const clear = active.avoid === null || distance(self.position, active.target) > active.avoid.radius;
      const destination = destinationOf(self.objective);
      return clear && (destination === null || distance(self.position, destination) < distance(active.target, destination));
    }
    case 'supportArrived': {
      // Only a promise still standing counts: an old one that lapsed means nothing now.
      const promise = knowledge.expectedSupport;
      const promised = promise !== null && tick >= promise.etaAt && tick <= promise.lapsesAt;
      return promised || suppressedNow(self, knowledge, active.target, tick);
    }
  }
}

export type DrillStep = Readonly<{
  drill: Drill | null;
  /** A drill that did what it set out to, rather than running out of time. */
  finished: Drill | null;
  handled: readonly HandledPosition[];
}>;

/** Keeps, ends or starts the platoon's drill, from its own picture. */
export function nextDrill(self: UnitSelf, knowledge: UnitKnowledge, tick: number, map: DrillMap): DrillStep {
  const kept = self.handled;
  const active = self.drill;
  if (self.mode !== 'steady') return { drill: null, finished: null, handled: kept };
  const trimmed = { ...self, handled: kept };

  if (active !== null) {
    const met = goalMet(trimmed, knowledge, active, tick);
    // Nobody answering is an answer too: after a while the platoon decides without air.
    const limit = active.kind === 'waitForAir' ? self.doctrine.airWaitSeconds : self.doctrine.drillSeconds;
    const refused = active.kind === 'waitForAir' && knowledge.supportRefusedAt !== null && knowledge.supportRefusedAt >= active.startedAt;
    const expired = refused || tick - active.startedAt >= limit;
    if (!met && !expired) {
      const nearest = nearestHostile(trimmed, knowledge, tick);
      // Holding drills give way once air operations says the position is being suppressed.
      if (HOLDING_DRILLS.has(active.kind)) {
        const pushed = pushThroughIfSuppressed(trimmed, knowledge, active.target, tick, map);
        if (pushed !== null) return { drill: pushed, finished: null, handled: kept };
      }
      const caught =
        self.underFire &&
        nearest !== null &&
        active.kind !== 'nearAmbush' &&
        active.kind !== 'attack' &&
        !(active.kind === 'pushThrough' && suppressedNow(trimmed, knowledge, active.target, tick)) &&
        distance(self.position, nearest.position.center) <= self.doctrine.nearAmbushMeters &&
        knows(self, 'nearAmbush');
      return {
        drill: caught ? drill(trimmed, 'nearAmbush', nearest.position.center, tick, map) : active,
        finished: null,
        handled: kept,
      };
    }
    if (active.kind === 'waitForAir') {
      const asked = [...kept, { center: active.target, tick, askedAir: true }];
      // Air has come: go through under it. Otherwise answer the position as if there were none.
      const next = met && knows(self, 'pushThrough') ? drill(trimmed, 'pushThrough', active.target, tick, map, true) : null;
      return { drill: next, finished: met ? active : null, handled: asked };
    }
    // An assault that ran out of time starts again: its objective still stands.
    const again = !met && self.objective.kind === 'AssaultArea';
    return { drill: null, finished: met ? active : null, handled: again ? kept : [...kept, { center: active.target, tick }] };
  }
  return { drill: startDrill(trimmed, knowledge, tick, map), finished: null, handled: kept };
}

/** A role for each squad, listed by how near each is to the target. */
export function assignRoles(
  active: Drill,
  doctrine: UnitSelf['doctrine'],
  ranges: readonly number[],
): readonly SquadRole[] {
  const definition = DRILLS[active.kind];
  if (ranges.length === 1) return [definition.solo];
  // Too few to send any wide: they all stay and fight.
  if (ranges.length < definition.flankFrom) return ranges.map(() => definition.lead);
  const order = ranges.map((range, index) => ({ range, index })).sort((a, b) => a.range - b.range || a.index - b.index);
  const leads = Math.max(1, Math.min(ranges.length - 1, Math.round(ranges.length * doctrine.supportShare)));
  const roles: SquadRole[] = ranges.map(() => definition.rest);
  for (const { index } of order.slice(0, leads)) roles[index] = definition.lead;
  return roles;
}

/** Whether an ambush should spring: fired on, or the enemy inside the distance. */
export function ambushSprung(self: UnitSelf, knowledge: UnitKnowledge, openFireMeters: number, tick: number): boolean {
  if (self.ambushSprung || self.underFire) return true;
  const nearest = nearestHostile(self, knowledge, tick);
  return nearest !== null && distance(nearest.position.center, self.position) <= openFireMeters;
}
