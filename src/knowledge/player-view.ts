import type { AircraftTelemetry } from '../domain/public/air';
import type { ContactEstimate, PositionEstimate } from '../domain/public/estimates';
import type { Vec2 } from '../domain/public/geometry';
import type { RadioMessage } from '../domain/public/radio';
import type { PlayerKnowledge, PositionSource } from './player-knowledge';
import {
  markerOpacity,
  reachableRegion,
  regionOpacity,
  type DisplayParameters,
  type ReachableRegion,
} from './reachability';

export type { ReachableRegion };

export type ContactMarker = Readonly<{
  key: string;
  contact: ContactEstimate;
  viaAircraft: boolean;
  ageSeconds: number;
  opacity: number;
  region: ReachableRegion;
  regionOpacity: number;
  engaging: boolean;
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
}>;

export type StrikeEffect = Readonly<{
  aircraftId: string;
  position: Vec2;
  ageSeconds: number;
  effectObserved: boolean;
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
}>;

const sortedEntries = <T>(record: Readonly<Record<string, T>>): readonly (readonly [string, T])[] =>
  Object.keys(record)
    .sort()
    .map((key) => [key, record[key] as T]);

/** The only route from knowledge to the UI. It cannot see truth: none is passed in. */
export function project(
  player: PlayerKnowledge,
  telemetry: AircraftTelemetry,
  tick: number,
  display: DisplayParameters & Readonly<{ effectSeconds: number }>,
): PlayerView {
  const age = (position: PositionEstimate): number => tick - position.observedAt;
  const recent = (at: number | undefined): boolean => at !== undefined && tick - at <= display.effectSeconds;
  return {
    tick,
    contacts: sortedEntries(player.contacts).map(([key, { contact, viaAircraft }]) => ({
      key,
      contact,
      viaAircraft,
      ageSeconds: age(contact.position),
      opacity: markerOpacity(age(contact.position), display),
      region: reachableRegion(contact.position, age(contact.position), display),
      regionOpacity: regionOpacity(age(contact.position), display),
      engaging: contact.activity === 'engaging' && age(contact.position) <= display.effectSeconds,
    })),
    friendlies: sortedEntries(player.friendlies).map(([unitId, marker]) => ({
      unitId,
      position: marker.position,
      source: marker.source,
      ageSeconds: age(marker.position),
      opacity: markerOpacity(age(marker.position), display),
      region: reachableRegion(marker.position, age(marker.position), display),
      regionOpacity: regionOpacity(age(marker.position), display),
      engaging: recent(player.friendlyEngagedAt[unitId]) || recent(player.ticFlags[unitId]?.receivedAt),
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
  };
}
