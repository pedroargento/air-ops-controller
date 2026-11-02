import type { AircraftOrder, CrewAttack, CrewDecision, CrewSelf, FiredOn, StrikeWeapon, WeaponsControl } from '../domain/public/air';
import { cos, sin } from '../domain/public/det-math';
import { isAntiAir } from '../domain/public/equipment';
import type { ContactEstimate } from '../domain/public/estimates';
import { distance, type Vec2 } from '../domain/public/geometry';
import { rainVisibilityMeters, weatherAt } from '../domain/public/weather';


const isFresh = (self: CrewSelf, tick: number): boolean => self.tick - tick <= self.threatMemorySeconds;

function recentFire(self: CrewSelf): CrewSelf['firedOn'] {
  return self.firedOn.filter((entry) => isFresh(self, entry.tick));
}

/** The ceiling of every weapon this crew has met or seen, which is what caution stays above. */
function threatCeiling(self: CrewSelf): number {
  const met = recentFire(self).flatMap((entry) => (entry.weapon === null ? [] : [entry.weapon]));
  const seen = self.contacts.flatMap((contact) => contact.observedWeapons);
  return Math.max(0, ...[...met, ...seen].map((weapon) => self.weaponCeilings[weapon]));
}

function stationAltitude(self: CrewSelf): number {
  const point = self.searchPoint ?? self.destination ?? self.position;
  const { forecast } = self;
  let wanted = self.defaultAltitudeMeters;
  if (forecast !== null) {
    // Reads the forecast where it's working: out of sight of the ground it can do nothing.
    const { ceilingMeters, rain } = weatherAt(forecast, point, self.tick);
    const seeing = rainVisibilityMeters(forecast, rain) * self.tuning.rainSightShare;
    wanted = Math.min(wanted, ceilingMeters - self.tuning.cloudMarginMeters, seeing);
  }
  // Recon can afford height once shot at. Strikes suffer more from it than a hit costs.
  const shaken = recentFire(self).length > 0 && self.risk !== 'pressOn' && self.role === 'recon';
  if (shaken || (self.risk === 'cautious' && threatCeiling(self) > 0)) wanted = Math.max(wanted, threatCeiling(self) + self.tuning.cloudMarginMeters);
  return wanted;
}

function wantedAltitude(self: CrewSelf): number | null {
  if (self.manualAltitude) return null;
  if (self.attackRun !== null) return self.attackRun.releaseAltitudeMeters;
  const transit = self.status === 'enroute' && self.role === 'cas' && self.risk !== 'cautious';
  const wanted = transit ? self.minAltitudeMeters : stationAltitude(self);
  return Math.max(self.minAltitudeMeters, Math.min(self.maxAltitudeMeters, wanted));
}

/** Fire worth leaving for, by the risk the controller accepted. */
function fireToBreakFrom(self: CrewSelf): Vec2 | null {
  if (self.risk === 'pressOn' || self.status !== 'onStation') return null;
  const latest = self.firedOn.at(-1);
  if (latest === undefined || self.tick - latest.tick > self.breakReactionSeconds) return null;
  return self.risk === 'cautious' || seriousFire(latest) ? latest.center : null;
}

function searchPlan(self: CrewSelf): Readonly<{ point: Vec2 | null; leg: number }> {
  const { order, searchLeg } = self;
  // Recon searches what it's told to watch. A strike aircraft circles, ready to come in.
  const searching = order?.kind === 'Watch' && self.role === 'recon';
  if (!searching || self.status !== 'onStation' || self.rotary) return { point: null, leg: searchLeg };
  // Whatever it has found is worth watching, and a doubtful contact most of all.
  const found = self.contacts.filter((contact) => distance(contact.position.center, order.center) <= order.radius);
  const watch = found.find((contact) => contact.identification === 'unidentified') ?? found[0];
  if (watch !== undefined) return { point: watch.position.center, leg: searchLeg };
  const legPoint = (leg: number): Vec2 => {
    if (leg % self.tuning.searchLegs === 0) return order.center;
    const angle = (2 * Math.PI * (leg % self.tuning.searchLegs)) / (self.tuning.searchLegs - 1);
    const ring = order.radius * self.tuning.searchRingShare;
    return { x: order.center.x + cos(angle) * ring, y: order.center.y + sin(angle) * ring };
  };
  const reached = distance(self.position, legPoint(searchLeg)) <= self.tuning.searchReachedMeters;
  const leg = reached ? searchLeg + 1 : searchLeg;
  return { point: legPoint(leg), leg };
}

/** How a crew flies its mission, from its own picture and never from truth (§8.0). */
export function decideCrew(self: CrewSelf): CrewDecision {
  const search = searchPlan(self);
  return {
    altitudeMeters: wantedAltitude(self),
    breakFrom: self.attackRun === null ? fireToBreakFrom(self) : null,
    searchPoint: search.point,
    searchLeg: search.leg,
  };
}

/**
 * Under a Guns order the job is to keep heads down for as long as it can, so bursts are
 * spread over the time on station. Otherwise they go as fast as the runs allow.
 */
function gunPace(self: CrewSelf, allowed: WeaponsControl): number {
  const fastest = self.passIntervalSeconds * self.gunPassFactor;
  if (allowed !== 'guns' || self.gunBursts <= 1) return fastest;
  return Math.max(fastest, Math.min(self.passIntervalSeconds * 2, self.enduranceSeconds / self.gunBursts));
}

function seriousFire(entry: FiredOn): boolean {
  return entry.hit || (entry.weapon !== null && isAntiAir(entry.weapon));
}

/** Small arms are the job. Only a cautious crew stays off a place for those. */
function nearFire(self: CrewSelf, point: Vec2): boolean {
  return recentFire(self)
    .filter((entry) => self.risk === 'cautious' || seriousFire(entry))
    .some((entry) => distance(entry.center, point) <= self.tuning.threatStandoffMeters);
}

/**
 * What to attack, and with what. Air defense comes first, since left alone it takes aircraft
 * out of the fight. Otherwise a crew stays off where it was shot at, unless told to press on.
 */
export function chooseAttack(
  self: CrewSelf,
  targets: readonly ContactEstimate[],
  closeToFriends: (contact: ContactEstimate, weapon: StrikeWeapon) => boolean = () => false,
): CrewAttack | null {
  const antiAir = (contact: ContactEstimate): boolean => contact.observedWeapons.some(isAntiAir);
  if (self.weapons === 'hold') return null;
  const safe = self.risk === 'pressOn' ? targets : targets.filter((contact) => antiAir(contact) || !nearFire(self, contact.position.center));
  const ordered = [...safe.filter(antiAir), ...safe.filter((contact) => !antiAir(contact))];
  const allowed = self.weapons;
  const guns = allowed !== 'heavy' && self.gunBursts > 0 && self.gunsReachable;
  // Heavy ordnance does the most, so it goes first. Guns hit a small area, so they can
  // work closer to friends than a bomb can, and they're what's left when bombs run out.
  const bombs = allowed !== 'guns' && self.ammunition > 0;
  const heavy = bombs ? ordered.find((contact) => !closeToFriends(contact, 'heavy')) : undefined;
  if (heavy !== undefined) return { contact: heavy, weapon: 'heavy', nextPassSeconds: self.passIntervalSeconds };
  const gunTarget = guns ? ordered.find((contact) => !closeToFriends(contact, 'guns')) : undefined;
  if (gunTarget === undefined) return null;
  return { contact: gunTarget, weapon: 'guns', nextPassSeconds: gunPace(self, allowed) };
}

/** A pass on a place the controller chose, `done` once the task is over or can't go on. */
export type PlacePass = Readonly<{ aim: Vec2; weapon: StrikeWeapon; nextPassSeconds: number }> | 'done' | null;

const GOLDEN_ANGLE = 2.399963229728653;
const SUPPRESS_POINTS = 7;

/**
 * Keeps heads down over the area until the window closes, so the bursts are spread to last
 * it, and the fire is walked across the area rather than poured into one spot.
 */
export function chooseSuppression(
  self: CrewSelf,
  order: Extract<AircraftOrder, { kind: 'Suppress' }>,
  closeToFriends: (point: Vec2) => boolean = () => false,
): PlacePass {
  if (self.tick > order.untilTick || self.gunBursts <= 0) return 'done';
  if (!self.gunsReachable) return null;
  if (self.risk !== 'pressOn' && nearFire(self, order.center)) return null;
  const left = self.gunBursts;
  const ring = order.radius * self.tuning.suppressSpreadShare;
  // The next point in the walk that's clear of friends, so fire moves away from them.
  const points = Array.from({ length: SUPPRESS_POINTS }, (_, index) => {
    const step = left + index;
    const angle = step * GOLDEN_ANGLE;
    const reach = step % 3 === 0 ? 0 : ring;
    return { x: order.center.x + cos(angle) * reach, y: order.center.y + sin(angle) * reach };
  });
  // Nowhere clear: the crew holds rather than fire near its own side.
  const aim = points.find((point) => !closeToFriends(point));
  if (aim === undefined) return null;
  const fastest = self.passIntervalSeconds * self.gunPassFactor;
  const window = Math.min(order.untilTick - self.tick, self.enduranceSeconds);
  return { aim, weapon: 'guns', nextPassSeconds: Math.max(fastest, window / left) };
}

/** One heavy pass on the place, then the order is done. */
export function chooseStrike(self: CrewSelf, order: Extract<AircraftOrder, { kind: 'Strike' }>): PlacePass {
  if (self.ammunition <= 0) return 'done';
  if (self.risk !== 'pressOn' && nearFire(self, order.center)) return null;
  return { aim: order.center, weapon: 'heavy', nextPassSeconds: self.passIntervalSeconds };
}
