import type { AircraftTelemetry } from '../domain/public/air';
import type { WeaponType } from '../domain/public/equipment';
import type { ContactEstimate, PositionEstimate } from '../domain/public/estimates';
import { distance, type Vec2 } from '../domain/public/geometry';
import type { RadioMessage } from '../domain/public/radio';
import {
  couldBeSameContact,
  type ContactStatus,
  type GroundFireMark,
  type PlayerContact,
  type PlayerKnowledge,
  type PositionSource,
  type UnitStatusReport,
} from './player-knowledge';
import {
  markerOpacity,
  reachableRegion,
  regionOpacity,
  type DisplayParameters,
  type ReachableRegion,
} from './reachability';

export type { ContactStatus, ReachableRegion, UnitStatusReport };

export type ContactMarker = Readonly<{
  key: string;
  contact: ContactEstimate;
  viaAircraft: boolean;
  ageSeconds: number;
  opacity: number;
  region: ReachableRegion;
  regionOpacity: number;
  engaging: boolean;
  status: ContactStatus;
  estimatedLosses: number;
  // Older reports this marker has absorbed: nothing is deleted, and a player can split them out.
  members: readonly ContactMarker[];
}>;

export type FriendlyMarkerView = Readonly<{
  unitId: string;
  position: PositionEstimate;
  source: PositionSource;
  ageSeconds: number;
  opacity: number;
  region: ReachableRegion;
  regionOpacity: number;
  engaging: boolean;
  silent: boolean;
  statusReport: UnitStatusReport | null;
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
  friendlies: readonly FriendlyMarkerView[];
  ticFlags: readonly Readonly<{ unitId: string; position: PositionEstimate; ageSeconds: number }>[];
  supportRequests: readonly Readonly<{ unitId: string; position: PositionEstimate; acknowledged: boolean }>[];
  log: readonly RadioMessage[];
  aircraft: AircraftTelemetry;
  strikes: readonly StrikeEffect[];
  groundFire: readonly GroundFireEffect[];
  archivedContacts: number;
  estimatedLosses: number;
  confirmedDestroyed: number;
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
    consolidateMaxAgeSeconds: number;
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

const isConfirming = (marker: ContactMarker, display: ViewParameters): boolean =>
  marker.viaAircraft &&
  marker.contact.confidence !== 'low' &&
  marker.ageSeconds <= display.consolidateMaxAgeSeconds &&
  (marker.status === 'active' || marker.status === 'hit');

/**
 * A fresh, confident aircraft sighting absorbs older reports that could be the same unit.
 * Only such a sighting does this, and it works from estimates, so close units can be
 * wrongly merged. Anything any report saw carries over, so a weapon isn't lost.
 */
function consolidate(markers: readonly ContactMarker[], display: ViewParameters): readonly ContactMarker[] {
  const confirming = markers
    .filter((marker) => isConfirming(marker, display))
    .sort((a, b) => a.ageSeconds - b.ageSeconds || (a.key < b.key ? -1 : 1));
  const absorbed = new Set<string>();
  const groups = new Map<string, ContactMarker>();
  for (const primary of confirming) {
    if (absorbed.has(primary.key)) continue;
    const members = markers.filter(
      (other) =>
        other.key !== primary.key &&
        !absorbed.has(other.key) &&
        !groups.has(other.key) &&
        (other.status === 'active' || other.status === 'hit') &&
        couldBeSameContact(primary.contact, other.contact, display.plausibleSpeedMps),
    );
    if (members.length === 0) continue;
    for (const member of members) absorbed.add(member.key);
    const weapons = new Set([primary, ...members].flatMap((m) => m.contact.observedWeapons));
    groups.set(primary.key, {
      ...primary,
      contact: { ...primary.contact, observedWeapons: [...weapons].sort() },
      estimatedLosses: members.reduce((sum, m) => sum + m.estimatedLosses, primary.estimatedLosses),
      members,
    });
  }
  return markers.filter((m) => !absorbed.has(m.key)).map((m) => groups.get(m.key) ?? m);
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
  const held = sortedEntries(player.contacts).filter(([, entry]) => !isArchived(entry, tick, display));
  const markers = held.map(([key, entry]): ContactMarker => ({
    key,
    contact: entry.contact,
    viaAircraft: entry.viaAircraft,
    ageSeconds: age(entry.contact.position),
    opacity: markerOpacity(age(entry.contact.position), display),
    region: reachableRegion(entry.contact.position, age(entry.contact.position), display),
    regionOpacity: regionOpacity(age(entry.contact.position), display),
    engaging: entry.contact.activity === 'engaging' && age(entry.contact.position) <= display.effectSeconds,
    status: entry.status,
    estimatedLosses: entry.estimatedLosses,
    members: [],
  }));
  return {
    tick,
    contacts: consolidate(markers, display),
    friendlies: sortedEntries(player.friendlies).map(([unitId, marker]) => ({
      unitId,
      position: marker.position,
      source: marker.source,
      ageSeconds: age(marker.position),
      opacity: markerOpacity(age(marker.position), display),
      region: reachableRegion(marker.position, age(marker.position), display),
      regionOpacity: regionOpacity(age(marker.position), display),
      engaging: recent(player.friendlyEngagedAt[unitId]) || recent(player.ticFlags[unitId]?.receivedAt),
      silent: age(marker.position) >= display.friendlySilentSeconds,
      statusReport: player.statusReports[unitId] ?? null,
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
    })),
    log: player.log,
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
    estimatedLosses: player.estimatedLosses,
    confirmedDestroyed: player.confirmedDestroyed,
  };
}
