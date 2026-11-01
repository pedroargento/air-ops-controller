import { cos, sin } from '../domain/public/det-math';
import { POI_KINDS } from '../domain/public/poi';
import type { AircraftId, AircraftTelemetryEntry } from '../domain/public/air';
import type { PlayerCommand } from '../domain/public/commands';
import { isAntiAir } from '../domain/public/equipment';
import { strengthMidpoint } from '../domain/public/estimates';
import { rainVisibilityMeters, weatherAt } from '../domain/public/weather';
import { distance, type Vec2 } from '../domain/public/geometry';
import type { ContactMarker, PlayerView } from '../knowledge/player-view';

// Automated players. They see exactly what a human sees and act only through commands.
export type Policy = (view: PlayerView) => readonly PlayerCommand[];

const SUPPORT_RADIUS_METERS = 500;
const RECON_RADIUS_METERS = 1500;
const FRESH_CONTACT_SECONDS = 120;
const NEARBY_FORWARD_METERS = 1200;
const KILL_ZONE_REACH_METERS = 150;
const KILL_ZONE_GROUP_METERS = 150;
const DEFAULT_LAUNCH_RANGE_METERS = 1300;
const SECOND_CAS_CONTACTS = 3;
const THREAT_MEMORY_SECONDS = 900;
const CAS_STATION_METERS = 650;
const CLOUD_MARGIN_METERS = 80;
const MIN_UNDER_CLOUD_METERS = 100;
/** Stays well inside the visibility, since a target isn't directly below. */
const RAIN_SIGHT_SHARE = 0.7;
const THREAT_STANDOFF_METERS = 900;
const STRUCK_RADIUS_METERS = 300;

export const noAir: Policy = () => [];

const cas = (view: PlayerView): readonly AircraftTelemetryEntry[] =>
  view.aircraft.filter((aircraft) => aircraft.aircraftType === 'cas');

/** Going home is the player's call, so a spent aircraft is sent back to rearm. */
function recallEmpty(view: PlayerView): readonly PlayerCommand[] {
  return cas(view)
    .filter((aircraft) => aircraft.ammunition <= 0 && aircraft.status !== 'returning' && aircraft.status !== 'turnaround')
    .map((aircraft) => ({
      kind: 'aircraftOrder',
      tick: view.tick,
      aircraftId: aircraft.aircraftId,
      order: { kind: 'ReturnToBase' },
    }));
}

const order = (view: PlayerView, aircraftId: AircraftId, center: Vec2, radius: number): PlayerCommand => ({
  kind: 'aircraftOrder',
  tick: view.tick,
  aircraftId,
  order: { kind: 'SupportArea', center, radius },
});

const engaged = (aircraft: AircraftTelemetryEntry): boolean =>
  aircraft.status === 'takeoff' || aircraft.status === 'enroute' || aircraft.status === 'onStation';

/** Answers each support request with whatever CAS is ready, in the requester's reported position. */
export function reactiveCas(): Policy {
  return (view) => {
    const commands: PlayerCommand[] = [...recallEmpty(view)];
    const taken = new Set<string>();
    for (const request of view.supportRequests) {
      if (request.acknowledged) continue;
      const aircraft = cas(view).find((a) => a.status === 'ready' && !taken.has(a.aircraftId));
      if (aircraft === undefined) {
        commands.push({ kind: 'acknowledge', tick: view.tick, unitId: request.unitId, casAircraftId: null });
        continue;
      }
      taken.add(aircraft.aircraftId);
      commands.push(order(view, aircraft.aircraftId, request.position.center, SUPPORT_RADIUS_METERS));
      commands.push({ kind: 'acknowledge', tick: view.tick, unitId: request.unitId, casAircraftId: aircraft.aircraftId });
    }
    return commands;
  };
}

/** Diagnostic baseline: sends every ready CAS at the newest hostile report. */
export function immediateCas(): Policy {
  return (view) => {
    const newest = [...view.contacts]
      .filter((marker) => marker.contact.identification === 'hostile')
      .sort((a, b) => a.ageSeconds - b.ageSeconds || (a.key < b.key ? -1 : 1))[0];
    if (newest === undefined) return recallEmpty(view);
    return [
      ...recallEmpty(view),
      ...cas(view)
        .filter((aircraft) => aircraft.status === 'ready')
        .map((aircraft) => order(view, aircraft.aircraftId, newest.contact.position.center, SUPPORT_RADIUS_METERS)),
    ];
  };
}

function freshAirContacts(view: PlayerView, objective: Vec2): readonly ContactMarker[] {
  return view.contacts
    .filter(
      (marker) =>
        marker.viaAircraft &&
        marker.status !== 'destroyed' &&
        marker.contact.identification === 'hostile' &&
        marker.ageSeconds <= FRESH_CONTACT_SECONDS,
    )
    .slice()
    .sort(
      (a, b) =>
        distance(a.contact.position.center, objective) - distance(b.contact.position.center, objective) ||
        (a.key < b.key ? -1 : 1),
    );
}

const isAntiAirContact = (marker: ContactMarker): boolean => marker.contact.observedWeapons.some(isAntiAir);

/** Already hit recently, so another pass there is better spent on something else. */
function recentlyStruck(view: PlayerView, marker: ContactMarker): boolean {
  return view.log.some(
    (message) =>
      message.kind === 'STRIKE_RESULT' &&
      view.tick - message.sentAt <= THREAT_MEMORY_SECONDS &&
      distance(message.contact.position.center, marker.contact.position.center) <= STRUCK_RADIUS_METERS,
  );
}

/** Where aircraft have recently been fired on, as far as the crews could tell. */
function recentFireSources(view: PlayerView): readonly Vec2[] {
  return view.log.flatMap((message) =>
    message.kind === 'GROUND_FIRE' && view.tick - message.sentAt <= THREAT_MEMORY_SECONDS ? [message.source.center] : [],
  );
}

function forwardNew(view: PlayerView, contacts: readonly ContactMarker[], forwarded: Set<string>): readonly PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const marker of contacts) {
    const token = `${marker.key}@${marker.contact.position.center.x}`;
    if (forwarded.has(token)) continue;
    const recipients = view.friendlies
      .filter((friendly) => distance(friendly.position.center, marker.contact.position.center) <= NEARBY_FORWARD_METERS)
      .map((friendly) => friendly.unitId);
    if (recipients.length === 0) continue;
    forwarded.add(token);
    commands.push({ kind: 'forwardContact', tick: view.tick, contactKey: marker.key, recipients });
  }
  return commands;
}

/** Reads the forecast at each aircraft's destination: out of sight of the ground it can do nothing. */
function underCloud(view: PlayerView): readonly PlayerCommand[] {
  const { forecast } = view;
  if (forecast === null) return [];
  return view.aircraft.flatMap((aircraft) => {
    const order = aircraft.order;
    const point = order !== null && 'center' in order ? order.center : aircraft.position;
    const arrival = view.tick + (aircraft.etaSeconds ?? 0);
    const { ceilingMeters, rain } = weatherAt(forecast, point, arrival);
    const seeing = rainVisibilityMeters(forecast, rain) * RAIN_SIGHT_SHARE;
    const wanted = Math.max(MIN_UNDER_CLOUD_METERS, Math.min(CAS_STATION_METERS, ceilingMeters - CLOUD_MARGIN_METERS, seeing));
    if (Math.abs(aircraft.targetAltitudeMeters - wanted) < CLOUD_MARGIN_METERS) return [];
    return [{ kind: 'setAltitude', tick: view.tick, aircraftId: aircraft.aircraftId, meters: wanted } as const];
  });
}

/** Scouts first, sends CAS to confirmed air contacts, and optionally shares them with ground units. */
export function reconInformed(
  objective: Vec2,
  forward: boolean,
  launchRangeMeters: number = DEFAULT_LAUNCH_RANGE_METERS,
  threatAware: boolean = true,
  climbAfterFireMeters: number | null = null,
  casTransitMeters: number | null = null,
  stayUnderCloud: boolean = false,
): Policy {
  const forwarded = new Set<string>();
  return (view) => {
    const commands: PlayerCommand[] = [...recallEmpty(view)];
    if (stayUnderCloud) commands.push(...underCloud(view));
    if (casTransitMeters !== null) {
      // A pop-up attack: stay down on the way in, then climb to work the target.
      for (const aircraft of cas(view)) {
        const wanted = aircraft.status === 'onStation' ? CAS_STATION_METERS : casTransitMeters;
        if (aircraft.targetAltitudeMeters === wanted) continue;
        commands.push({ kind: 'setAltitude', tick: view.tick, aircraftId: aircraft.aircraftId, meters: wanted });
      }
    }
    if (climbAfterFireMeters !== null && view.log.some((message) => message.kind === 'GROUND_FIRE')) {
      // Recon can afford height. CAS can't: strikes are its job, and they suffer more than a hit costs.
      for (const aircraft of view.aircraft) {
        if (aircraft.aircraftType !== 'recon' || aircraft.targetAltitudeMeters === climbAfterFireMeters) continue;
        commands.push({ kind: 'setAltitude', tick: view.tick, aircraftId: aircraft.aircraftId, meters: climbAfterFireMeters });
      }
    }
    for (const recon of view.aircraft) {
      if (recon.aircraftType === 'recon' && recon.status === 'ready') {
        commands.push({
          kind: 'aircraftOrder',
          tick: view.tick,
          aircraftId: recon.aircraftId,
          order: { kind: 'ReconArea', center: objective, radius: RECON_RADIUS_METERS },
        });
      }
    }

    const fireSources = threatAware ? recentFireSources(view) : [];
    const safe = (marker: ContactMarker): boolean =>
      isAntiAirContact(marker) ||
      !fireSources.some((source) => distance(source, marker.contact.position.center) <= THREAT_STANDOFF_METERS);
    const fresh = freshAirContacts(view, objective).filter(safe);
    // Known air defense comes first: left alone it keeps taking aircraft out of the fight.
    const byStrength = [...fresh].sort(
      (a, b) => strengthMidpoint(b.contact.strength) - strengthMidpoint(a.contact.strength),
    );
    const priority = (marker: ContactMarker): boolean => isAntiAirContact(marker) && !recentlyStruck(view, marker);
    const contacts = threatAware ? [...byStrength.filter(priority), ...byStrength.filter((m) => !priority(m))] : byStrength;
    const nearest = contacts[0];
    if (nearest !== undefined) {
      const point = nearest.contact.position.center;
      const threatened = priority(nearest) || distance(point, objective) <= launchRangeMeters;
      const committed = cas(view).filter(engaged).length;
      const wanted = contacts.length >= SECOND_CAS_CONTACTS ? 2 : 1;
      const ready = cas(view).filter((aircraft) => aircraft.status === 'ready');
      if (threatened) {
        for (const aircraft of ready.slice(0, Math.max(0, wanted - committed))) {
          commands.push(order(view, aircraft.aircraftId, point, SUPPORT_RADIUS_METERS));
        }
      }
      for (const aircraft of cas(view)) {
        if (aircraft.status !== 'onStation' || aircraft.order?.kind !== 'SupportArea') continue;
        const covered = contacts.some(
          (marker) => distance(marker.contact.position.center, (aircraft.order as { center: Vec2 }).center) <= SUPPORT_RADIUS_METERS,
        );
        if (!covered) commands.push(order(view, aircraft.aircraftId, point, SUPPORT_RADIUS_METERS));
      }
    }

    for (const request of view.supportRequests) {
      if (request.acknowledged) continue;
      const coming = cas(view).find(
        (aircraft) =>
          aircraft.order?.kind === 'SupportArea' &&
          distance(aircraft.order.center, request.position.center) <= SUPPORT_RADIUS_METERS,
      );
      commands.push({
        kind: 'acknowledge',
        tick: view.tick,
        unitId: request.unitId,
        casAircraftId: coming?.aircraftId ?? null,
      });
    }

    if (forward) commands.push(...forwardNew(view, contacts, forwarded));
    return commands;
  };
}

/** The same policy with its strike aircraft kept on the ground: what information alone is worth. */
export function scoutingOnly(policy: Policy): Policy {
  return (view) => {
    const strikers = new Set(cas(view).map((aircraft) => aircraft.aircraftId as string));
    return policy(view).filter((command) => !('aircraftId' in command) || !strikers.has(command.aircraftId));
  };
}

/** Where a still contact is looking, if the crew saw. */
function facedPoint(marker: ContactMarker): Vec2 | null {
  const { facingRad, position } = marker.contact;
  if (facingRad === undefined || marker.contact.activity !== 'stationary') return null;
  return {
    x: position.center.x + cos(facingRad) * KILL_ZONE_REACH_METERS,
    y: position.center.y + sin(facingRad) * KILL_ZONE_REACH_METERS,
  };
}

/**
 * Reads the pattern as a player would: still squads looking at the same ground. It works
 * only from what crews reported, so it can miss an ambush or mark an empty road.
 */
export function markingKillZones(policy: Policy, minContacts = 2): Policy {
  return (view) => {
    const commands = [...policy(view)];
    // Consolidation can fold squads into one marker, and each of them still looked somewhere.
    const faced = view.contacts.flatMap((marker) => [marker, ...marker.members]).flatMap((marker) => {
      const point = marker.contact.identification === 'hostile' ? facedPoint(marker) : null;
      return point === null ? [] : [point];
    });
    for (const point of faced) {
      const together = faced.filter((other) => distance(other, point) <= KILL_ZONE_GROUP_METERS);
      if (together.length < minContacts) continue;
      if (view.pois.some((poi) => distance(poi.center, point) <= KILL_ZONE_GROUP_METERS * 2)) continue;
      const center = {
        x: together.reduce((sum, other) => sum + other.x, 0) / together.length,
        y: together.reduce((sum, other) => sum + other.y, 0) / together.length,
      };
      commands.push({
        kind: 'reportPoi',
        tick: view.tick,
        poiKind: 'killZone',
        center,
        radiusMeters: POI_KINDS.killZone.radiusMeters,
        recipients: view.friendlies.map((friendly) => friendly.unitId),
      });
      break;
    }
    return commands;
  };
}

/** Works through a list of areas in turn: a planned search rather than a single orbit. */
export function sweepingRecon(areas: readonly Vec2[], radiusMeters: number, dwellSeconds: number): Policy {
  return (view) => {
    const recon = view.aircraft.filter((aircraft) => aircraft.aircraftType === 'recon');
    const leg = Math.floor(view.tick / dwellSeconds);
    return recon.flatMap((aircraft, index) => {
      const center = areas[(leg + index * Math.ceil(areas.length / recon.length)) % areas.length] as Vec2;
      const assigned = aircraft.order?.kind === 'ReconArea' && distance(aircraft.order.center, center) < 1;
      if (assigned || (aircraft.status !== 'ready' && aircraft.status !== 'onStation' && aircraft.status !== 'enroute')) return [];
      return [{ kind: 'aircraftOrder', tick: view.tick, aircraftId: aircraft.aircraftId, order: { kind: 'ReconArea', center, radius: radiusMeters } } as const];
    });
  };
}
