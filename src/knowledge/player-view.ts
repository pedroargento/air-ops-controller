import type { SupportWeapons } from '../domain/public/air';
import type { AircraftTelemetry } from '../domain/public/air';
import type { WeaponType } from '../domain/public/equipment';
import {
  strengthCategory,
  strengthMidpoint,
  type ContactEstimate,
  type PositionEstimate,
  type StrengthEstimate,
} from '../domain/public/estimates';
import { distance, type Vec2 } from '../domain/public/geometry';
import type { Poi } from '../domain/public/poi';
import { AIR_OPS, CECON, reportLevel, type RadioMessage, type ReportLevel } from '../domain/public/radio';
import type { Weather } from '../domain/public/weather';
import {
  couldBeSameContact,
  type ContactStatus,
  type GroundFireMark,
  type PlayerContact,
  type PlayerKnowledge,
  type PositionSource,
  type RequestAnswer,
  type MedevacAnswer,
  type UnitStatusReport,
} from './player-knowledge';
import { markerOpacity, type DisplayParameters } from './reachability';
import { claimsOf, fuse } from './tracks';
import { fireLines, underFire, type FireLine, type UnderFire } from './fire-view';

export type { FireEnd, FireLine, UnderFire } from './fire-view';

export type { ContactStatus, UnitStatusReport };

/** A sender that has just been heard, so the map can show who is talking. */
export type ReportingUnit = Readonly<{ senderId: string; level: ReportLevel }>;

/** Reports drawn as one group. It counts reports, and says nothing about organization. */
export type ContactCluster = Readonly<{
  center: Vec2;
  radiusMeters: number;
  reports: number;
  strength: StrengthEstimate;
}>;

export type ContactMarker = Readonly<{
  key: string;
  contact: ContactEstimate;
  viaAircraft: boolean;
  ageSeconds: number;
  opacity: number;
  /** Not seen for a while: drawn with a dashed frame at its last known position. */
  stale: boolean;
  engaging: boolean;
  status: ContactStatus;
  /** Strike damage and claims, summed over the track's reports. */
  estimatedLosses: number;
  /** The track's other reports: nothing is deleted, and a player can split them out. */
  members: readonly ContactMarker[];
  /** TN 4001 and up, or null for a report not yet on a track. */
  trackNumber: number | null;
  /** Another track could also have taken one of its reports. */
  ambiguous: boolean;
}>;

export type FriendlyMarkerView = Readonly<{
  unitId: string;
  position: PositionEstimate;
  source: PositionSource;
  ageSeconds: number;
  opacity: number;
  engaging: boolean;
  silent: boolean;
  statusReport: UnitStatusReport | null;
  /** Danger close cleared for this unit until then, or null. */
  dangerCloseUntil: number | null;
  /** Under fire, by its own word or a crew's sight (§7.3), or null. */
  underFire: UnderFire | null;
}>;

export type StrikeEffect = Readonly<{
  aircraftId: string;
  position: Vec2;
  ageSeconds: number;
  effectObserved: boolean;
}>;

export type GroundFireEffect = Readonly<{
  aircraftId: string;
  position: Vec2;
  ageSeconds: number;
  hit: boolean;
  weapon: WeaponType | null;
  opacity: number;
}>;

export type PlayerView = Readonly<{
  tick: number;
  contacts: readonly ContactMarker[];
  clusters: readonly ContactCluster[];
  pois: readonly Poi[];
  /** Who has just been heard on the radio. */
  reporting: readonly ReportingUnit[];
  friendlies: readonly FriendlyMarkerView[];
  ticFlags: readonly Readonly<{ unitId: string; position: PositionEstimate; ageSeconds: number }>[];
  supportRequests: readonly Readonly<{
    unitId: string;
    position: PositionEstimate;
    acknowledged: boolean;
    dangerClose: boolean;
    wants: SupportWeapons;
    target: Vec2 | null;
    targetStrength: StrengthEstimate | null;
    marked: boolean;
    ageSeconds: number;
    answer: RequestAnswer | null;
    /** Danger close cleared for this unit until then, or null. */
    dangerCloseUntil: number | null;
  }>[];
  medevacRequests: readonly Readonly<{
    unitId: string;
    position: PositionEstimate;
    wounded: number;
    pickup: Vec2;
    hot: boolean;
    ageSeconds: number;
    answer: MedevacAnswer | null;
  }>[];
  log: readonly RadioMessage[];
  /** Who is firing at whom, as far as crews saw and units reported (§7.3). */
  fire: readonly FireLine[];
  aircraft: AircraftTelemetry;
  strikes: readonly StrikeEffect[];
  groundFire: readonly GroundFireEffect[];
  archivedContacts: number;
  /** Flares the controller knows of, while they burn. */
  flares: readonly Readonly<{ position: Vec2; radiusMeters: number; light: number; ageSeconds: number; burnSeconds: number; by: string }>[];
  /** Smoke marks crews have reported, while they last. */
  smoke: readonly Readonly<{ position: Vec2; ageSeconds: number }>[];
  /** Aircrews' strike assessments. */
  estimatedLosses: number;
  /** Ground units' claims on the tracks shown, each track counted once at its largest claim. */
  groundClaims: number;
  confirmedDestroyed: number;
  forecast: Weather | null;
  forecastIssuedAt: number | null;
}>;

const sortedEntries = <T>(record: Readonly<Record<string, T>>): readonly (readonly [string, T])[] =>
  Object.keys(record)
    .sort()
    .map((key) => [key, record[key] as T]);

/**
 * One mark per place: a sustained engagement would otherwise stack into an unreadable
 * pile. Each keeps its newest report, and remembers any hit and any weapon seen there.
 */
function mergeGroundFire(
  marks: readonly GroundFireMark[],
  tick: number,
  display: DisplayParameters & Readonly<{ groundFireMarkSeconds: number; groundFireMergeMeters: number }>,
): readonly GroundFireEffect[] {
  const merged: GroundFireMark[] = [];
  const newestFirst = marks.filter((mark) => tick - mark.tick <= display.groundFireMarkSeconds).reverse();
  for (const mark of newestFirst) {
    const index = merged.findIndex((kept) => distance(kept.position, mark.position) <= display.groundFireMergeMeters);
    const kept = merged[index];
    if (kept === undefined) merged.push(mark);
    else merged[index] = { ...kept, hit: kept.hit || mark.hit, weapon: kept.weapon ?? mark.weapon };
  }
  return merged.map(({ aircraftId, position, tick: at, hit, weapon }) => ({
    aircraftId,
    position,
    ageSeconds: tick - at,
    hit,
    weapon,
    opacity: Math.max(display.opacityFloor, 1 - (tick - at) / display.groundFireMarkSeconds),
  }));
}

type ViewParameters = DisplayParameters &
  Readonly<{
    effectSeconds: number;
    groundFireMarkSeconds: number;
    groundFireMergeMeters: number;
    archiveSeconds: number;
    destroyedShowSeconds: number;
    notFoundShowSeconds: number;
    friendlySilentSeconds: number;
    staleSeconds: number;
    consolidateMaxAgeSeconds: number;
    freshReportSeconds: number;
    clusterRadiusMeters: number;
    reportBlinkSeconds: number;
    fireLineFreshSeconds: number;
    fireLineSeconds: number;
  }>;

export function couldBeSameReport(a: ContactMarker, b: ContactMarker, plausibleSpeedMps: number): boolean {
  return couldBeSameContact(a.contact, b.contact, plausibleSpeedMps);
}

/** Old reports leave the map but stay in the radio log. Closed ones go sooner. */
function isArchived(entry: PlayerContact, tick: number, display: ViewParameters): boolean {
  if (entry.status === 'destroyed') return tick - entry.statusAt > display.destroyedShowSeconds;
  if (entry.status === 'not-found') return tick - entry.statusAt > display.notFoundShowSeconds;
  return tick - entry.contact.position.observedAt > display.archiveSeconds;
}

/**
 * One marker per track, fused from its reports (§7.2). A report not yet put on a track shows
 * on its own. The reports stay as members, so the player can split a track and see them all.
 */
function trackMarkers(player: PlayerKnowledge, reports: readonly ContactMarker[], tick: number, display: ViewParameters): readonly ContactMarker[] {
  const byTrack = new Map<string, ContactMarker[]>();
  for (const marker of reports) {
    const trackId = player.trackOf[marker.key] ?? marker.key;
    const group = byTrack.get(trackId);
    if (group === undefined) byTrack.set(trackId, [marker]);
    else group.push(marker);
  }
  return [...byTrack.entries()].map(([trackId, group]) => {
    const track = player.tracks[trackId];
    if (track === undefined || group.length === 0) return { ...(group[0] as ContactMarker), trackNumber: null };
    const entries = group.flatMap((marker) => {
      const entry = player.contacts[marker.key];
      return entry === undefined ? [] : [[marker.key, entry] as const];
    });
    const fused = fuse(entries, tick, display.plausibleSpeedMps);
    const primary = group.find((marker) => marker.key === fused.primaryKey) ?? (group[0] as ContactMarker);
    const freshest = Math.min(...group.map((marker) => marker.ageSeconds));
    return {
      ...primary,
      key: trackId,
      trackNumber: track.number,
      ambiguous: track.ambiguous,
      contact: fused.contact,
      viaAircraft: fused.viaAircraft,
      ageSeconds: freshest,
      opacity: markerOpacity(freshest, display),
      stale: freshest >= display.staleSeconds,
      engaging: group.some((marker) => marker.engaging),
      status: fused.status,
      estimatedLosses: fused.losses,
      members: group.filter((marker) => marker !== primary),
    };
  });
}

/**
 * Nearby fresh hostile markers, drawn together. Built from markers alone, so it counts
 * reports, not units: it claims no organization and contains nothing nobody reported.
 */
function clusterContacts(markers: readonly ContactMarker[], display: ViewParameters): readonly ContactCluster[] {
  const eligible = markers.filter(
    (marker) =>
      marker.contact.identification === 'hostile' &&
      marker.ageSeconds <= display.freshReportSeconds &&
      (marker.status === 'active' || marker.status === 'hit'),
  );
  const parent = new Map(eligible.map((marker) => [marker.key, marker.key]));
  const find = (key: string): string => {
    const up = parent.get(key) ?? key;
    return up === key ? key : find(up);
  };
  for (let i = 0; i < eligible.length; i += 1) {
    for (let j = i + 1; j < eligible.length; j += 1) {
      const a = eligible[i] as ContactMarker;
      const b = eligible[j] as ContactMarker;
      if (distance(a.contact.position.center, b.contact.position.center) > display.clusterRadiusMeters) continue;
      const [low, high] = [find(a.key), find(b.key)].sort() as [string, string];
      parent.set(high, low);
    }
  }
  const groups = new Map<string, ContactMarker[]>();
  for (const marker of eligible) {
    const root = find(marker.key);
    const group = groups.get(root);
    if (group === undefined) groups.set(root, [marker]);
    else group.push(marker);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const centers = group.map((marker) => marker.contact.position.center);
      const center = {
        x: centers.reduce((sum, point) => sum + point.x, 0) / centers.length,
        y: centers.reduce((sum, point) => sum + point.y, 0) / centers.length,
      };
      return {
        center,
        radiusMeters: Math.max(...centers.map((point) => distance(center, point))),
        reports: group.length,
        strength: strengthCategory(group.reduce((sum, marker) => sum + strengthMidpoint(marker.contact.strength), 0)),
      };
    });
}

const LEVEL_RANK: Readonly<Record<ReportLevel, number>> = { routine: 0, main: 1, urgent: 2 };

/** Reads the newest end of the log only, so it stays cheap however long the log gets. */
function recentReporters(log: readonly RadioMessage[], tick: number, seconds: number): readonly ReportingUnit[] {
  const reporters = new Map<string, ReportLevel>();
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const message = log[index] as RadioMessage;
    if (tick - message.receivedAt > seconds) break;
    if (message.senderId === CECON || message.senderId === AIR_OPS) continue;
    const level = reportLevel(message);
    const held = reporters.get(message.senderId);
    if (held === undefined || LEVEL_RANK[level] > LEVEL_RANK[held]) reporters.set(message.senderId, level);
  }
  return [...reporters.entries()]
    .map(([senderId, level]) => ({ senderId, level }))
    .sort((a, b) => (a.senderId < b.senderId ? -1 : 1));
}

/** The only route from knowledge to the UI. It cannot see truth: none is passed in. */
export function project(
  player: PlayerKnowledge,
  telemetry: AircraftTelemetry,
  tick: number,
  display: ViewParameters,
): PlayerView {
  const age = (position: PositionEstimate): number => tick - position.observedAt;
  const recent = (at: number | undefined): boolean => at !== undefined && tick - at <= display.effectSeconds;
  const clearedUntil = (unitId: string): number | null => {
    const until = player.dangerCloseClearedUntil[unitId];
    return until !== undefined && until >= tick ? until : null;
  };
  const held = sortedEntries(player.contacts).filter(([, entry]) => !isArchived(entry, tick, display));
  const markers = held.map(([key, entry]): ContactMarker => ({
    key,
    contact: entry.contact,
    viaAircraft: entry.viaAircraft,
    ageSeconds: age(entry.contact.position),
    opacity: markerOpacity(age(entry.contact.position), display),
    stale: age(entry.contact.position) >= display.staleSeconds,
    engaging: entry.contact.activity === 'engaging' && age(entry.contact.position) <= display.effectSeconds,
    status: entry.status,
    estimatedLosses: entry.estimatedLosses + (entry.contact.claimedLosses ?? 0),
    members: [],
    trackNumber: null,
    ambiguous: false,
  }));
  const contacts = trackMarkers(player, markers, tick, display);
  const shown = new Map<string, Readonly<{ key: string; position: Vec2 }>>();
  for (const marker of contacts) {
    const at = { key: marker.key, position: marker.contact.position.center };
    for (const key of [marker.key, ...(player.tracks[marker.key]?.reports ?? []), ...marker.members.map((member) => member.key)]) shown.set(key, at);
  }
  const fire = fireLines(player, (key) => shown.get(key) ?? shown.get(player.trackOf[key] ?? '') ?? null, tick, display);
  const firedOn = underFire(player, fire, tick, display);
  return {
    tick,
    contacts,
    clusters: clusterContacts(contacts, display),
    pois: player.pois,
    reporting: recentReporters(player.log, tick, display.reportBlinkSeconds),
    friendlies: sortedEntries(player.friendlies).map(([unitId, marker]) => ({
      unitId,
      position: marker.position,
      source: marker.source,
      ageSeconds: age(marker.position),
      opacity: markerOpacity(age(marker.position), display),
      engaging: recent(player.friendlyEngagedAt[unitId]) || recent(player.ticFlags[unitId]?.receivedAt),
      silent: age(marker.position) >= display.friendlySilentSeconds,
      statusReport: player.statusReports[unitId] ?? null,
      dangerCloseUntil: clearedUntil(unitId),
      underFire: firedOn[unitId] ?? null,
    })),
    ticFlags: sortedEntries(player.ticFlags).map(([unitId, flag]) => ({
      unitId,
      position: flag.position,
      ageSeconds: tick - flag.receivedAt,
    })),
    supportRequests: sortedEntries(player.supportRequests).map(([unitId, request]) => ({
      unitId,
      position: request.position,
      acknowledged: request.acknowledged,
      dangerClose: request.dangerClose,
      wants: request.wants,
      target: request.target,
      targetStrength: request.targetStrength,
      marked: request.marked,
      ageSeconds: tick - request.receivedAt,
      answer: request.answer,
      dangerCloseUntil: clearedUntil(unitId),
    })),
    medevacRequests: sortedEntries(player.medevacRequests).map(([unitId, request]) => ({
      unitId,
      position: request.position,
      wounded: request.wounded,
      pickup: request.pickup,
      hot: request.hot,
      ageSeconds: tick - request.receivedAt,
      answer: request.answer,
    })),
    log: player.log,
    fire,
    aircraft: telemetry,
    strikes: player.strikes
      .filter((strike) => recent(strike.tick))
      .map(({ aircraftId, position, tick: at, effectObserved }) => ({
        aircraftId,
        position,
        ageSeconds: tick - at,
        effectObserved,
      })),
    groundFire: mergeGroundFire(player.groundFire, tick, display),
    archivedContacts: Object.keys(player.contacts).length - held.length,
    smoke: player.smoke.map((mark) => ({ position: mark.position, ageSeconds: tick - mark.placedAt })),
    flares: player.flares.map((flare) => ({
      position: flare.position,
      radiusMeters: flare.radiusMeters,
      light: flare.light,
      ageSeconds: tick - flare.ignitedAt,
      burnSeconds: flare.burnSeconds,
      by: flare.by,
    })),
    estimatedLosses: player.estimatedLosses,
    groundClaims: contacts.reduce((sum, marker) => {
      const reports = (player.tracks[marker.key]?.reports ?? [marker.key]).flatMap((key) => {
        const entry = player.contacts[key];
        return entry === undefined ? [] : [[key, entry] as const];
      });
      return sum + Math.max(0, ...claimsOf(reports).bySource.values());
    }, 0),
    confirmedDestroyed: player.confirmedDestroyed,
    forecast: player.forecast,
    forecastIssuedAt: player.forecastIssuedAt,
  };
}
