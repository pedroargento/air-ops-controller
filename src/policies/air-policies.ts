import { cos, sin } from '../domain/public/det-math';
import { ambientLight } from '../domain/public/light';
import { POI_KINDS } from '../domain/public/poi';
import type { AircraftId, AircraftTelemetryEntry, RiskLimit, SupportWeapons } from '../domain/public/air';
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
const KILL_ZONE_REACH_METERS = 150;
const KILL_ZONE_GROUP_METERS = 150;
const SAME_SQUAD_METERS = 30;
const DEFAULT_LAUNCH_RANGE_METERS = 1300;
const SECOND_CAS_CONTACTS = 3;
const THREAT_MEMORY_SECONDS = 900;
const STRUCK_RADIUS_METERS = 300;
const SUPPRESS_RADIUS_METERS = 150;
const AMBUSH_REACH_METERS = 400;

export const noAir: Policy = () => [];

const cas = (view: PlayerView): readonly AircraftTelemetryEntry[] =>
  view.aircraft.filter((aircraft) => aircraft.aircraftType === 'cas');

/**
 * Going home is the player's call, so a spent aircraft is sent back to rearm. Bombs gone
 * counts as spent: guns keep a crew useful, but low runs get aircraft hit.
 */
function recallEmpty(view: PlayerView): readonly PlayerCommand[] {
  return cas(view)
    .filter((aircraft) => aircraft.ammunition <= 0)
    .filter((aircraft) => aircraft.status !== 'returning' && aircraft.status !== 'turnaround' && aircraft.status !== 'ready')
    .map((aircraft) => ({
      kind: 'aircraftOrder',
      tick: view.tick,
      aircraftId: aircraft.aircraftId,
      order: { kind: 'ReturnToBase' },
    }));
}

/** Sends a strike aircraft to watch an area, free to use the weapons given. */
const order = (
  view: PlayerView,
  aircraftId: AircraftId,
  center: Vec2,
  radius: number,
  weapons: SupportWeapons = 'both',
): readonly PlayerCommand[] => [
  { kind: 'setWeapons', tick: view.tick, aircraftId, weapons },
  { kind: 'aircraftOrder', tick: view.tick, aircraftId, order: { kind: 'Watch', center, radius } },
];

const watching = (aircraft: AircraftTelemetryEntry): Vec2 | null =>
  aircraft.order?.kind === 'Watch' ? aircraft.order.center : null;

const engaged = (aircraft: AircraftTelemetryEntry): boolean =>
  aircraft.status === 'takeoff' || aircraft.status === 'enroute' || aircraft.status === 'onStation';

/** The hostile on the controller's map nearest a point, if one is close enough to be what's firing. */
function nearestHostile(view: PlayerView, point: Vec2): Vec2 | null {
  const [nearest] = view.contacts
    .filter((marker) => marker.status !== 'destroyed' && marker.contact.identification === 'hostile')
    .map((marker) => marker.contact.position.center)
    .filter((center) => distance(center, point) <= NEARBY_FORWARD_METERS)
    .sort((a, b) => distance(a, point) - distance(b, point));
  return nearest ?? null;
}

/**
 * Answers each support request with whatever CAS is ready, in the requester's reported position.
 * With `suppressSeconds`, it suppresses the hostile nearest the requester on the map instead.
 */
export function reactiveCas(suppressSeconds: number | null = null): Policy {
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
      // Gives the unit what it asked for, where it asked for it.
      const target = suppressSeconds === null ? null : (request.target ?? nearestHostile(view, request.position.center));
      if (suppressSeconds !== null && target !== null) {
        const mission = { kind: 'Suppress', center: target, radius: SUPPRESS_RADIUS_METERS, untilTick: view.tick + suppressSeconds } as const;
        commands.push({ kind: 'aircraftOrder', tick: view.tick, aircraftId: aircraft.aircraftId, order: mission });
      } else {
        // Support goes where the unit is: it covers whatever is attacking it, not just the one target named.
        commands.push(...order(view, aircraft.aircraftId, request.position.center, SUPPORT_RADIUS_METERS, request.wants));
      }
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
        .flatMap((aircraft) => order(view, aircraft.aircraftId, newest.contact.position.center, SUPPORT_RADIUS_METERS)),
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
      distance(message.aim, marker.contact.position.center) <= STRUCK_RADIUS_METERS,
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
): Policy {
  const forwarded = new Set<string>();
  return (view) => {
    const commands: PlayerCommand[] = [...recallEmpty(view)];
    for (const recon of view.aircraft) {
      if (recon.aircraftType === 'recon' && recon.status === 'ready') {
        commands.push({
          kind: 'aircraftOrder',
          tick: view.tick,
          aircraftId: recon.aircraftId,
          order: { kind: 'Watch', center: objective, radius: RECON_RADIUS_METERS },
        });
      }
    }

    const fresh = freshAirContacts(view, objective);
    // Known air defense comes first: left alone it keeps taking aircraft out of the fight.
    const byStrength = [...fresh].sort(
      (a, b) => strengthMidpoint(b.contact.strength) - strengthMidpoint(a.contact.strength),
    );
    const priority = (marker: ContactMarker): boolean => isAntiAirContact(marker) && !recentlyStruck(view, marker);
    const contacts = [...byStrength.filter(priority), ...byStrength.filter((m) => !priority(m))];
    const nearest = contacts[0];
    if (nearest !== undefined) {
      const point = nearest.contact.position.center;
      const threatened = priority(nearest) || distance(point, objective) <= launchRangeMeters;
      const committed = cas(view).filter(engaged).length;
      const wanted = contacts.length >= SECOND_CAS_CONTACTS ? 2 : 1;
      const ready = cas(view).filter((aircraft) => aircraft.status === 'ready');
      if (threatened) {
        for (const aircraft of ready.slice(0, Math.max(0, wanted - committed))) {
          commands.push(...order(view, aircraft.aircraftId, point, SUPPORT_RADIUS_METERS));
        }
      }
      for (const aircraft of cas(view)) {
        const center = watching(aircraft);
        if (aircraft.status !== 'onStation' || center === null) continue;
        const covered = contacts.some((marker) => distance(marker.contact.position.center, center) <= SUPPORT_RADIUS_METERS);
        if (!covered) commands.push(...order(view, aircraft.aircraftId, point, SUPPORT_RADIUS_METERS));
      }
    }

    for (const request of view.supportRequests) {
      if (request.acknowledged) continue;
      const coming = cas(view).find((aircraft) => {
        const center = watching(aircraft);
        return center !== null && distance(center, request.position.center) <= SUPPORT_RADIUS_METERS;
      });
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
      return point === null ? [] : [{ point, from: marker.contact.position.center }];
    });
    for (const { point, from } of faced) {
      const looking = faced.filter((other) => distance(other.point, point) <= KILL_ZONE_GROUP_METERS);
      const together = looking.map((other) => other.point);
      // Two crews on one squad are one squad, so only separate positions count.
      const squads = looking.filter((other) => distance(other.from, from) >= SAME_SQUAD_METERS).length + 1;
      if (squads < minContacts) continue;
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
      const assigned = aircraft.order?.kind === 'Watch' && distance(aircraft.order.center, center) < 1;
      if (assigned || (aircraft.status !== 'ready' && aircraft.status !== 'onStation' && aircraft.status !== 'enroute')) return [];
      return [{ kind: 'aircraftOrder', tick: view.tick, aircraftId: aircraft.aircraftId, order: { kind: 'Watch', center, radius: radiusMeters } } as const];
    });
  };
}

/** Answers every danger close request the same way: a controller's standing rule. */
export function answeringDangerClose(policy: Policy, approved: boolean): Policy {
  return (view) => [
    ...policy(view),
    ...view.supportRequests
      .filter((request) => request.dangerClose)
      .map((request) => ({ kind: 'answerDangerClose', tick: view.tick, unitId: request.unitId, approved }) as const),
  ];
}

/** Sets every aircraft's risk limit once, as a controller might at the start of a mission. */
export function atRisk(policy: Policy, risk: RiskLimit): Policy {
  return (view) => [
    ...policy(view),
    ...view.aircraft
      .filter((aircraft) => aircraft.risk !== risk)
      .map((aircraft) => ({ kind: 'setRisk', tick: view.tick, aircraftId: aircraft.aircraftId, risk }) as const),
  ];
}

/** Keeps strike aircraft on station with their guns once the bombs are gone. */
export function lingeringOnGuns(policy: Policy): Policy {
  return (view) => {
    const lingering = new Set(cas(view).filter((aircraft) => aircraft.gunBursts > 0).map((aircraft) => aircraft.aircraftId as string));
    return policy(view).filter(
      (command) => !(command.kind === 'aircraftOrder' && command.order.kind === 'ReturnToBase' && lingering.has(command.aircraftId)),
    );
  };
}

/** Answers ground units' support requests, as asked, with any strike aircraft left over. */
export function answeringRequests(policy: Policy): Policy {
  const answer = reactiveCas();
  return (view) => {
    const own = policy(view);
    const busy = new Set(own.flatMap((command) => ('aircraftId' in command ? [command.aircraftId as string] : [])));
    const free = { ...view, aircraft: view.aircraft.filter((aircraft) => !busy.has(aircraft.aircraftId)) };
    return [...own, ...answer(free).filter((command) => command.kind !== 'aircraftOrder' || command.order.kind !== 'ReturnToBase')];
  };
}

/** Strike aircraft that can take a fire mission now, with guns to do it. */
function canSuppress(aircraft: AircraftTelemetryEntry): boolean {
  return aircraft.aircraftType === 'cas' && !aircraft.damaged && aircraft.gunBursts > 0 && aircraft.status !== 'returning' && aircraft.status !== 'turnaround';
}

/** Where the ambush watching a kill zone sits: the hostiles crews saw near it, if any. */
function ambushAt(view: PlayerView, killZone: Vec2): Vec2 | null {
  const seen = view.contacts.filter(
    (marker) =>
      marker.status !== 'destroyed' &&
      marker.contact.identification === 'hostile' &&
      distance(marker.contact.position.center, killZone) <= AMBUSH_REACH_METERS,
  );
  if (seen.length === 0) return null;
  return {
    x: seen.reduce((sum, marker) => sum + marker.contact.position.center.x, 0) / seen.length,
    y: seen.reduce((sum, marker) => sum + marker.contact.position.center.y, 0) / seen.length,
  };
}

/**
 * Times air to the ground: as a friendly platoon nears a marked kill zone, a strike aircraft
 * suppresses the ambush watching it, and goes back to its own targets once the platoons are
 * clear. Only what the controller's map shows goes into it: the mark, the crews' sightings and
 * the platoons' own reports.
 */
export function suppressingKillZones(policy: Policy, leadMeters = 500, windowSeconds = 900): Policy {
  const answered = new Map<string, AircraftId>();
  return (view) => {
    const near = (point: Vec2): boolean => view.friendlies.some((friendly) => distance(friendly.position.center, point) <= leadMeters);
    const commands: PlayerCommand[] = [];
    const busy = new Set<string>();
    // A mission whose platoons are all clear of it ends, and the aircraft is free again.
    for (const aircraft of cas(view)) {
      if (aircraft.order?.kind !== 'Suppress') continue;
      if (near(aircraft.order.center)) busy.add(aircraft.aircraftId);
      else commands.push(...order(view, aircraft.aircraftId, aircraft.order.center, SUPPORT_RADIUS_METERS, aircraft.weapons === 'hold' ? 'both' : aircraft.weapons));
    }
    const free = (command: PlayerCommand): boolean => !('aircraftId' in command) || !busy.has(command.aircraftId);
    const ended = new Set(commands.flatMap((command) => ('aircraftId' in command ? [command.aircraftId as string] : [])));
    let own = policy(view).filter((command) => free(command) && (!('aircraftId' in command) || !ended.has(command.aircraftId)));
    for (const poi of view.pois) {
      if (poi.kind !== 'killZone' || answered.has(poi.id) || !near(poi.center)) continue;
      const center = ambushAt(view, poi.center);
      if (center === null) continue;
      const [aircraft] = cas(view)
        .filter((candidate) => canSuppress(candidate) && !busy.has(candidate.aircraftId))
        .sort(
          (a, b) =>
            Number(b.status === 'onStation') - Number(a.status === 'onStation') ||
            distance(a.position, center) - distance(b.position, center),
        );
      if (aircraft === undefined) continue;
      answered.set(poi.id, aircraft.aircraftId);
      busy.add(aircraft.aircraftId);
      own = own.filter(free);
      commands.push({
        kind: 'aircraftOrder',
        tick: view.tick,
        aircraftId: aircraft.aircraftId,
        order: { kind: 'Suppress', center, radius: SUPPRESS_RADIUS_METERS, untilTick: view.tick + windowSeconds },
      });
    }
    return [...own, ...commands];
  };
}

/**
 * Keeps strike aircraft with the lead platoon, the one nearest the destination on the map,
 * engaging what they find ahead of it, instead of going after sightings.
 */
export function coveringLead(policy: Policy, destination: Vec2, radiusMeters = SUPPORT_RADIUS_METERS): Policy {
  return (view) => {
    const strikers = new Set(cas(view).map((aircraft) => aircraft.aircraftId as string));
    const own = policy(view).filter(
      (command) => !(command.kind === 'aircraftOrder' && strikers.has(command.aircraftId) && command.order.kind !== 'ReturnToBase'),
    );
    const [lead] = [...view.friendlies].sort(
      (a, b) => distance(a.position.center, destination) - distance(b.position.center, destination) || (a.unitId < b.unitId ? -1 : 1),
    );
    if (lead === undefined) return own;
    const going = new Set(own.flatMap((command) => (command.kind === 'aircraftOrder' ? [command.aircraftId as string] : [])));
    const covers = cas(view)
      .filter((aircraft) => !going.has(aircraft.aircraftId) && !aircraft.damaged && aircraft.ammunition + aircraft.gunBursts > 0)
      .filter((aircraft) => aircraft.status === 'ready' || aircraft.status === 'enroute' || aircraft.status === 'onStation')
      .filter((aircraft) => !(aircraft.order?.kind === 'Cover' && aircraft.order.unitId === lead.unitId))
      .map((aircraft): PlayerCommand => ({
        kind: 'aircraftOrder',
        tick: view.tick,
        aircraftId: aircraft.aircraftId,
        order: { kind: 'Cover', unitId: lead.unitId, center: lead.position.center, radius: radiusMeters },
      }));
    return [...own, ...covers];
  };
}

const ILLUMINATE_SECONDS = 600;
const FIGHT_MEMORY_SECONDS = 300;
const LIT_REACH_METERS = 600;
const DARK_ENOUGH = 0.2;

/**
 * At night, keeps flares over every fight it hears of: a unit asking for support or reporting
 * troops in contact gets an aircraft with flares over it, recon first, so strike aircraft stay
 * free to attack what the light shows. By day it does nothing.
 */
export function illuminatingAtNight(policy: Policy): Policy {
  return (view) => {
    const sky = view.forecast?.sky;
    if (sky === undefined || ambientLight(sky, view.tick, 0) >= DARK_ENOUGH) return policy(view);
    const busy = new Set(view.aircraft.filter((aircraft) => aircraft.order?.kind === 'Illuminate').map((aircraft) => aircraft.aircraftId as string));
    const fights = [
      ...view.supportRequests.filter((request) => request.ageSeconds <= FIGHT_MEMORY_SECONDS).map((request) => request.target ?? request.position.center),
      ...view.ticFlags.filter((flag) => flag.ageSeconds <= FIGHT_MEMORY_SECONDS).map((flag) => flag.position.center),
    ];
    const commands: PlayerCommand[] = [];
    const lit: Vec2[] = [
      ...view.flares.map((flare) => flare.position),
      ...view.aircraft.flatMap((aircraft) => (aircraft.order?.kind === 'Illuminate' ? [aircraft.order.center] : [])),
    ];
    for (const fight of fights) {
      if (lit.some((point) => distance(point, fight) <= LIT_REACH_METERS)) continue;
      const [aircraft] = view.aircraft
        .filter((candidate) => candidate.flares > 0 && !candidate.damaged && !busy.has(candidate.aircraftId))
        .filter((candidate) => candidate.status !== 'returning' && candidate.status !== 'turnaround')
        .sort((a, b) => Number(a.aircraftType === 'cas') - Number(b.aircraftType === 'cas') || distance(a.position, fight) - distance(b.position, fight));
      if (aircraft === undefined) break;
      busy.add(aircraft.aircraftId);
      lit.push(fight);
      commands.push({
        kind: 'aircraftOrder',
        tick: view.tick,
        aircraftId: aircraft.aircraftId,
        // The light is wanted once the aircraft is there, so its time counts from arrival.
        order: { kind: 'Illuminate', center: fight, radius: SUPPORT_RADIUS_METERS, untilTick: view.tick + Math.ceil(aircraft.takeoffSeconds + distance(aircraft.position, fight) / aircraft.speedMps) + ILLUMINATE_SECONDS },
      });
    }
    const own = policy(view).filter((command) => !('aircraftId' in command) || !busy.has(command.aircraftId));
    return [...own, ...commands];
  };
}

const SURVIVOR_FRESH_SECONDS = 1800;
const LZ_CLEAR_METERS = 400;
const POSITION_ASK_SECONDS = 1200;
const DAYLIGHT = 0.5;

/**
 * A rescue as a controller might run it: ask the survivor where it is now and then, keep strike
 * aircraft covering it, and send the helicopter once its position is fresh and no enemy is known
 * near it. With `byDayOnly`, the helicopter goes only in daylight.
 */
export function rescuing(survivorId: string, byDayOnly: boolean, escorted = true): Policy {
  let askedAt = Number.NEGATIVE_INFINITY;
  return (view) => {
    const commands: PlayerCommand[] = [];
    const survivor = view.friendlies.find((friendly) => friendly.unitId === survivorId);
    if (view.tick - askedAt >= POSITION_ASK_SECONDS && (survivor === undefined || survivor.ageSeconds >= POSITION_ASK_SECONDS)) {
      askedAt = view.tick;
      commands.push({ kind: 'requestReport', tick: view.tick, unitId: survivorId, report: 'position' });
    }
    if (survivor === undefined) return commands;
    const where = survivor.position.center;
    for (const aircraft of view.aircraft) {
      const idle = aircraft.status === 'ready' || (aircraft.order === null && aircraft.status !== 'returning' && aircraft.status !== 'turnaround');
      if (escorted && aircraft.aircraftType === 'cas' && idle && aircraft.ammunition + aircraft.gunBursts > 0) {
        commands.push({ kind: 'aircraftOrder', tick: view.tick, aircraftId: aircraft.aircraftId, order: { kind: 'Cover', unitId: survivorId, center: where, radius: SUPPORT_RADIUS_METERS } });
      }
      if (aircraft.aircraftType === 'recon' && aircraft.seats === 0 && idle) {
        commands.push({ kind: 'aircraftOrder', tick: view.tick, aircraftId: aircraft.aircraftId, order: { kind: 'Watch', center: where, radius: 800 } });
      }
    }
    const sky = view.forecast?.sky;
    const light = sky === undefined ? 1 : ambientLight(sky, view.tick, 0);
    const fresh = survivor.ageSeconds <= SURVIVOR_FRESH_SECONDS;
    const clear = !view.contacts.some(
      (marker) => marker.contact.identification === 'hostile' && marker.status !== 'destroyed' && marker.ageSeconds <= SURVIVOR_FRESH_SECONDS && distance(marker.contact.position.center, where) <= LZ_CLEAR_METERS,
    );
    const helicopter = view.aircraft.find((aircraft) => aircraft.seats > 0 && aircraft.passengers === 0 && !aircraft.damaged && (aircraft.status === 'ready' || aircraft.status === 'onStation' || aircraft.status === 'enroute'));
    const going = helicopter?.order?.kind === 'Pickup';
    if (helicopter !== undefined && !going && fresh && clear && (!byDayOnly || light >= DAYLIGHT)) {
      commands.push({ kind: 'aircraftOrder', tick: view.tick, aircraftId: helicopter.aircraftId, order: { kind: 'Pickup', center: where, radius: 50 } });
    }
    return commands;
  };
}
