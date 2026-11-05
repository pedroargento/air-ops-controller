import type { SupportWeapons } from '../domain/public/air';
import type { Poi } from '../domain/public/poi';
import type { WeaponType } from '../domain/public/equipment';
import type { ContactEstimate, PositionEstimate, StrengthEstimate } from '../domain/public/estimates';
import { distance, type Vec2 } from '../domain/public/geometry';
import type { ObjectiveStatus, RadioMessage, StrikeAssessment } from '../domain/public/radio';
import type { Weather } from '../domain/public/weather';
import type { TrackRecord } from './tracks';
import type { Flare } from '../domain/public/light';
import type { FireStatus } from '../domain/public/fire';

/** A unit's last word on its own fight (§7.3), and where it said it was. */
export type UnitFireReport = Readonly<{ status: FireStatus; ownPosition: PositionEstimate; receivedAt: number; observedAt: number }>;

/**
 * One end of a fire line a crew saw: a friendly platoon, or a contact by its report key
 * (`source/contact`), which the map resolves to whatever track holds it.
 */
export type FireEndRef = Readonly<{ kind: 'friendly'; unitId: string } | { kind: 'contact'; key: string; contact: ContactEstimate }>;

/** Fire a crew saw: who was firing, which way, and at whom if the crew could see them too. */
export type SeenFire = Readonly<{ from: FireEndRef; to: FireEndRef | null; bearingRad: number; seenAt: number; aircraftId: string }>;

export type PositionSource = 'self-report' | 'aircraft';

export type FriendlyMarker = Readonly<{
  unitId: string;
  position: PositionEstimate;
  source: PositionSource;
  receivedAt: number;
}>;

export type Discrepancy = Readonly<{
  unitId: string;
  kept: PositionEstimate;
  conflicting: PositionEstimate;
  recordedAt: number;
}>;

export type ContactStatus = 'active' | 'hit' | 'destroyed' | 'not-found';

export type PlayerContact = Readonly<{
  contact: ContactEstimate;
  receivedAt: number;
  viaAircraft: boolean;
  status: ContactStatus;
  statusAt: number;
  estimatedLosses: number;
  clearLookSeconds: number;
}>;

export type UnitStatusReport = Readonly<{
  personnel: number;
  ammunitionFraction: number;
  status: ObjectiveStatus;
  receivedAt: number;
  /** Wounded it said it has (§4.1.1). */
  wounded?: number;
  /** A downed aircrew's last word on its water and battery (§8.8). */
  waterMinutes?: number;
  battery?: number;
}>;

/** An aircraft's sensors, as far as air operations can tell from telemetry. */
export type SensorCoverage = Readonly<{ position: Vec2; radiusMeters: number }>;

export type ContactReviewParameters = Readonly<{
  plausibleSpeedMps: number;
  notFoundMinAgeSeconds: number;
  notFoundLookSeconds: number;
  notFoundCoverage: number;
  consolidateMaxAgeSeconds: number;
}>;

export type SupportRequest = Readonly<{
  unitId: string;
  position: PositionEstimate;
  receivedAt: number;
  acknowledged: boolean;
  dangerClose: boolean;
  wants: SupportWeapons;
  target: Vec2 | null;
  targetStrength: StrengthEstimate | null;
  marked: boolean;
  /** How air operations answered, so the controller can see the answer took effect. */
  answer: RequestAnswer | null;
}>;

/**
 * An answer to a support request: aircraft inbound with its promised arrival, a plain "no air
 * available", or a promise air operations later had to call off.
 */
export type RequestAnswer =
  | Readonly<{ kind: 'inbound'; aircraftId: string; etaAt: number; answeredAt: number }>
  | Readonly<{ kind: 'none'; answeredAt: number }>
  | Readonly<{ kind: 'cancelled'; aircraftId: string; answeredAt: number }>;

/** A platoon's medevac request (§8.9), and how air operations answered it. */
export type MedevacRequest = Readonly<{
  unitId: string;
  position: PositionEstimate;
  receivedAt: number;
  wounded: number;
  pickup: Vec2;
  hot: boolean;
  answer: MedevacAnswer | null;
}>;

export type MedevacAnswer =
  | Readonly<{ kind: 'sent'; aircraftId: string; answeredAt: number }>
  | Readonly<{ kind: 'none'; answeredAt: number }>;

export type TicFlag = Readonly<{ unitId: string; position: PositionEstimate; receivedAt: number }>;

export type StrikeMark = Readonly<{
  aircraftId: string;
  position: Vec2;
  tick: number;
  effectObserved: boolean;
}>;

export type GroundFireMark = Readonly<{
  aircraftId: string;
  position: Vec2;
  tick: number;
  hit: boolean;
  weapon: WeaponType | null;
}>;

export type PlayerKnowledge = {
  pois: Poi[];
  /** Flares the controller knows of: dropped by its aircraft or fired by its platoons. */
  flares: Flare[];
  /** Smoke marks crews have reported seeing. */
  smoke: Readonly<{ position: Vec2; placedAt: number; platoonId: string; seenAt: number }>[];
  log: RadioMessage[];
  strikes: StrikeMark[];
  groundFire: GroundFireMark[];
  // When an aircraft last saw each friendly unit fighting.
  friendlyEngagedAt: Record<string, number>;
  contacts: Record<string, PlayerContact>;
  /** Air operations' tracks: which reports it believes are one enemy group (§7.2). */
  tracks: Record<string, TrackRecord>;
  trackOf: Record<string, string>;
  nextTrackNumber: number;
  friendlies: Record<string, FriendlyMarker>;
  discrepancies: Discrepancy[];
  supportRequests: Record<string, SupportRequest>;
  medevacRequests: Record<string, MedevacRequest>;
  /** Units cleared for danger close, and until when. */
  dangerCloseClearedUntil: Record<string, number>;
  ticFlags: Record<string, TicFlag>;
  /** Each unit's last word on its own fight. A report saying nothing about fire clears it. */
  unitFire: Record<string, UnitFireReport>;
  /** Fire crews have seen, by shooter. */
  seenFire: Record<string, SeenFire>;
  statusReports: Record<string, UnitStatusReport>;
  estimatedLosses: number;
  confirmedDestroyed: number;
  forecast: Weather | null;
  forecastIssuedAt: number | null;
};

export function emptyPlayerKnowledge(): PlayerKnowledge {
  return {
    log: [],
    strikes: [],
    groundFire: [],
    pois: [],
    smoke: [],
    flares: [],
    friendlyEngagedAt: {},
    contacts: {},
    tracks: {},
    trackOf: {},
    nextTrackNumber: 0,
    friendlies: {},
    discrepancies: [],
    supportRequests: {},
    medevacRequests: {},
    dangerCloseClearedUntil: {},
    ticFlags: {},
    unitFire: {},
    seenFire: {},
    statusReports: {},
    estimatedLosses: 0,
    confirmedDestroyed: 0,
    forecast: null,
    forecastIssuedAt: null,
  };
}

const isMoreReliable = (a: PositionEstimate, b: PositionEstimate): boolean => a.sigmaMeters < b.sigmaMeters;

/**
 * Evidence rule (§7): a newer report updates the marker, unless a comparably recent,
 * more reliable aircraft observation disagrees. The disagreement is recorded, not dropped.
 */
export function updateFriendly(
  player: PlayerKnowledge,
  unitId: string,
  position: PositionEstimate,
  source: PositionSource,
  receivedAt: number,
  comparableSeconds: number,
): void {
  const current = player.friendlies[unitId];
  if (current !== undefined) {
    if (position.observedAt < current.position.observedAt) return;
    const age = position.observedAt - current.position.observedAt;
    const aircraftOutranks =
      current.source === 'aircraft' &&
      source === 'self-report' &&
      age <= comparableSeconds &&
      isMoreReliable(current.position, position);
    if (aircraftOutranks) {
      player.discrepancies.push({ unitId, kept: current.position, conflicting: position, recordedAt: receivedAt });
      return;
    }
  }
  player.friendlies[unitId] = { unitId, position, source, receivedAt };
}

/** A new observation supersedes older ones within the same source track only. */
export function updateContact(player: PlayerKnowledge, contact: ContactEstimate, receivedAt: number, viaAircraft: boolean): void {
  const key = `${contact.provenance.sourceId}/${contact.contactId}`;
  const existing = player.contacts[key];
  if (existing !== undefined && contact.position.observedAt < existing.contact.position.observedAt) return;
  // A new sighting reopens a closed contact. A strike's damage stays on record.
  const closed = existing !== undefined && contact.position.observedAt <= existing.statusAt;
  const hit = existing?.status === 'hit';
  player.contacts[key] = {
    contact,
    receivedAt,
    viaAircraft,
    status: closed ? existing.status : hit ? 'hit' : 'active',
    statusAt: existing?.statusAt ?? -1,
    estimatedLosses: existing?.estimatedLosses ?? 0,
    clearLookSeconds: 0,
  };
}

/** Whether two reports could be one unit, from nothing but their estimates (§7). */
export function couldBeSameContact(a: ContactEstimate, b: ContactEstimate, plausibleSpeedMps: number): boolean {
  if (a.identification !== 'unidentified' && b.identification !== 'unidentified') {
    if (a.identification !== b.identification) return false;
  }
  const older = a.position.observedAt < b.position.observedAt ? a : b;
  const newer = older === a ? b : a;
  const elapsed = newer.position.observedAt - older.position.observedAt;
  const reach = elapsed * plausibleSpeedMps + older.position.sigmaMeters + newer.position.sigmaMeters;
  if (distance(a.position.center, b.position.center) > reach) return false;
  if (a.strength.kind === 'unknown' || b.strength.kind === 'unknown') return true;
  return a.strength.min <= b.strength.max && b.strength.min <= a.strength.max;
}

/** Records a strike's assessed result. A kill also closes reports that were likely the same unit. */
export function recordStrike(
  player: PlayerKnowledge,
  contact: ContactEstimate,
  assessment: StrikeAssessment,
  plausibleSpeedMps: number,
  tick: number,
): void {
  const key = `${contact.provenance.sourceId}/${contact.contactId}`;
  const entry = player.contacts[key];
  if (entry === undefined) return;
  player.estimatedLosses += assessment.estimatedCasualties;
  player.contacts[key] = {
    ...entry,
    status: assessment.destroyed ? 'destroyed' : 'hit',
    statusAt: tick,
    estimatedLosses: entry.estimatedLosses + assessment.estimatedCasualties,
  };
  if (!assessment.destroyed) return;
  player.confirmedDestroyed += 1;
  for (const other of Object.keys(player.contacts).sort()) {
    const candidate = player.contacts[other];
    if (candidate === undefined || other === key || candidate.status === 'destroyed') continue;
    if (!couldBeSameContact(contact, candidate.contact, plausibleSpeedMps)) continue;
    player.contacts[other] = { ...candidate, status: 'destroyed', statusAt: tick };
  }
}

/**
 * Seeing nothing is information: an aircraft that has had a clear look at a reported
 * position and found nothing there closes the report. It can be wrong, because concealed
 * units are missed, and a new sighting reopens it.
 */
export function reviewContacts(
  player: PlayerKnowledge,
  coverage: readonly SensorCoverage[],
  parameters: ContactReviewParameters,
  scanSeconds: number,
  tick: number,
): void {
  const entries = Object.keys(player.contacts).sort();
  const fresh = entries.flatMap((key) => {
    const entry = player.contacts[key];
    if (entry === undefined || !entry.viaAircraft) return [];
    return tick - entry.contact.position.observedAt <= parameters.consolidateMaxAgeSeconds ? [entry.contact] : [];
  });
  for (const key of entries) {
    const entry = player.contacts[key];
    if (entry === undefined || entry.status === 'destroyed' || entry.status === 'not-found') continue;
    const { contact } = entry;
    if (contact.identification === 'friendly') continue;
    if (tick - contact.position.observedAt < parameters.notFoundMinAgeSeconds) continue;
    const seen = coverage.some(
      ({ position, radiusMeters }) =>
        distance(position, contact.position.center) <= radiusMeters * parameters.notFoundCoverage,
    );
    if (!seen) continue;
    if (fresh.some((other) => couldBeSameContact(other, contact, parameters.plausibleSpeedMps))) continue;
    const clearLookSeconds = entry.clearLookSeconds + scanSeconds;
    player.contacts[key] =
      clearLookSeconds >= parameters.notFoundLookSeconds
        ? { ...entry, clearLookSeconds, status: 'not-found', statusAt: tick }
        : { ...entry, clearLookSeconds };
  }
}

/** Applies a message delivered to air operations. Ground reports count only from delivery. */
export function receiveByPlayer(player: PlayerKnowledge, message: RadioMessage, comparableSeconds: number): void {
  player.log.push(message);
  const friendly = (position: PositionEstimate): void =>
    updateFriendly(player, message.senderId, position, 'self-report', message.receivedAt, comparableSeconds);

  // A unit's report about itself says whether it is in a fight; saying nothing means it isn't.
  const fight = (ownPosition: PositionEstimate, status: FireStatus | undefined): void => {
    if (status === undefined) delete player.unitFire[message.senderId];
    else player.unitFire[message.senderId] = { status, ownPosition, receivedAt: message.receivedAt, observedAt: message.observedAt };
  };

  switch (message.kind) {
    case 'POSITION_REPORT':
      friendly(message.position);
      fight(message.position, message.fire);
      return;
    case 'CONTACT_REPORT':
      updateContact(player, message.contact, message.receivedAt, false);
      return;
    case 'TIC':
      friendly(message.ownPosition);
      player.ticFlags[message.senderId] = {
        unitId: message.senderId,
        position: message.ownPosition,
        receivedAt: message.receivedAt,
      };
      if (message.contact !== null) updateContact(player, message.contact, message.receivedAt, false);
      fight(message.ownPosition, message.fire);
      return;
    case 'SITREP':
      friendly(message.ownPosition);
      player.statusReports[message.senderId] = {
        personnel: message.personnel,
        ammunitionFraction: message.ammunitionFraction,
        status: message.status,
        receivedAt: message.receivedAt,
        ...(message.wounded === undefined ? {} : { wounded: message.wounded }),
        ...(message.waterMinutes === undefined ? {} : { waterMinutes: message.waterMinutes }),
        ...(message.battery === undefined ? {} : { battery: message.battery }),
      };
      fight(message.ownPosition, message.fire);
      return;
    case 'DRILL':
      friendly(message.ownPosition);
      return;
    case 'SUPPORT_REQUEST':
      friendly(message.ownPosition);
      player.supportRequests[message.senderId] = {
        unitId: message.senderId,
        position: message.ownPosition,
        receivedAt: message.receivedAt,
        acknowledged: false,
        dangerClose: message.dangerClose,
        wants: message.wants,
        target: message.target,
        targetStrength: message.targetStrength,
        marked: message.marked,
        answer: null,
      };
      fight(message.ownPosition, message.fire);
      return;
    case 'MEDEVAC_REQUEST':
      friendly(message.ownPosition);
      player.medevacRequests[message.senderId] = {
        unitId: message.senderId,
        position: message.ownPosition,
        receivedAt: message.receivedAt,
        wounded: message.wounded,
        pickup: message.pickup,
        hot: message.hot,
        answer: null,
      };
      return;
    case 'CHECK_FIRE':
      friendly(message.ownPosition);
      return;
    case 'DANGER_CLOSE_HOLD':
      return;
    case 'COMMAND_UPDATE':
    case 'ACKNOWLEDGEMENT':
    case 'INTEL_REPORT':
    case 'POI_REPORT':
    case 'SUPPRESSION':
    case 'PICKUP_POINT':
    case 'MEDEVAC_ANSWER':
    case 'STRIKE_RESULT':
    case 'GROUND_FIRE':
      return;
  }
}
