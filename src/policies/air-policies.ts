import type { AircraftId, AircraftTelemetryEntry } from '../domain/public/air';
import type { PlayerCommand } from '../domain/public/commands';
import { isAntiAir } from '../domain/public/equipment';
import { strengthMidpoint } from '../domain/public/estimates';
import { distance, type Vec2 } from '../domain/public/geometry';
import type { ContactMarker, PlayerView } from '../knowledge/player-view';

// Automated players. They see exactly what a human sees and act only through commands.
export type Policy = (view: PlayerView) => readonly PlayerCommand[];

const SUPPORT_RADIUS_METERS = 500;
const RECON_RADIUS_METERS = 1500;
const FRESH_CONTACT_SECONDS = 120;
const NEARBY_FORWARD_METERS = 1200;
const DEFAULT_LAUNCH_RANGE_METERS = 1300;
const SECOND_CAS_CONTACTS = 3;
const THREAT_MEMORY_SECONDS = 900;
const CAS_STATION_METERS = 650;
const THREAT_STANDOFF_METERS = 900;
const STRUCK_RADIUS_METERS = 300;

export const noAir: Policy = () => [];

const cas = (view: PlayerView): readonly AircraftTelemetryEntry[] =>
  view.aircraft.filter((aircraft) => aircraft.aircraftType === 'cas');

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
    const commands: PlayerCommand[] = [];
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
    if (newest === undefined) return [];
    return cas(view)
      .filter((aircraft) => aircraft.status === 'ready')
      .map((aircraft) => order(view, aircraft.aircraftId, newest.contact.position.center, SUPPORT_RADIUS_METERS));
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

/** Scouts first, sends CAS to confirmed air contacts, and optionally shares them with ground units. */
export function reconInformed(
  objective: Vec2,
  forward: boolean,
  launchRangeMeters: number = DEFAULT_LAUNCH_RANGE_METERS,
  threatAware: boolean = true,
  climbAfterFireMeters: number | null = null,
  casTransitMeters: number | null = null,
): Policy {
  const forwarded = new Set<string>();
  return (view) => {
    const commands: PlayerCommand[] = [];
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
