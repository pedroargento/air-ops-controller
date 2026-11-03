import { hypot } from '../domain/public/det-math';
import type { ContactEstimate, Identification, StrengthEstimate } from '../domain/public/estimates';
import { distance } from '../domain/public/geometry';
import type { ContactStatus, PlayerContact, PlayerKnowledge } from './player-knowledge';

/*
 * Tracks: the controller's own belief that several reports are one enemy group (§7.2). The
 * sim never says which reports belong together; air operations decides from the estimates,
 * as a real track manager does, and can be wrong.
 */

export type TrackRecord = Readonly<{
  id: string;
  /** Track number, as on a tactical data link: TN 4001 and up. */
  number: number;
  reports: readonly string[];
  /** When it was opened, another track could also have taken the report that opened it. */
  ambiguous: boolean;
  openedAt: number;
  /** Numbers of tracks later found to be this one and merged into it. */
  merged: readonly number[];
}>;

export type TrackParameters = Readonly<{ plausibleSpeedMps: number; archiveSeconds: number; staleSeconds: number }>;

export type FusedTrack = Readonly<{
  contact: ContactEstimate;
  primaryKey: string;
  viaAircraft: boolean;
  status: ContactStatus;
  /** Strike assessments plus the largest ground claim (§7.2). */
  losses: number;
  newestObservedAt: number;
}>;

const FIRST_TRACK_NUMBER = 4001;
/** A correlation gate, as track managers use: independent errors add, and three of them covers nearly all. */
const GATE_SIGMAS = 3;
const GATE_FLOOR_METERS = 30;
/** Two head counts of one unit rarely differ by more than this factor, whatever band each fell in. */
const STRENGTH_FACTOR = 2;
const CONTACT_STRENGTH_SECONDS = 300;
/** Reports this much less precise than the best still add to the position; worse ones only add noise. */
const COMPARABLE_FACTOR = 2;

type Entry = readonly [key: string, entry: PlayerContact];

/** How far off a report may be by now: its own error plus how far the unit could have gone. */
function uncertainty([, entry]: Entry, tick: number, plausibleSpeedMps: number): number {
  const { position } = entry.contact;
  return position.sigmaMeters + Math.max(0, tick - position.observedAt) * plausibleSpeedMps;
}

/**
 * Claimed losses on a track, deconflicted as a careful staff would. Each source counts once, at
 * its highest claim: its reports of a group and of a squad in it cover the same men. Units
 * watching the same fight all claim the same falls, so the track takes the largest ground claim,
 * not their sum. Aircrews' strike assessments are separate passes, so they add.
 */
export function claimsOf(entries: readonly (readonly [string, PlayerContact])[]): Readonly<{ losses: number; bySource: ReadonlyMap<string, number> }> {
  const bySource = new Map<string, number>();
  for (const [, entry] of entries) {
    const claim = entry.contact.claimedLosses ?? 0;
    if (claim <= 0) continue;
    const source = entry.contact.provenance.sourceId;
    bySource.set(source, Math.max(bySource.get(source) ?? 0, claim));
  }
  const strikes = entries.reduce((sum, [, entry]) => sum + entry.estimatedLosses, 0);
  return { losses: strikes + Math.max(0, ...bySource.values()), bySource };
}

/**
 * Each part of a track comes from the source best placed for it. Position, heading and
 * activity come from the most precise report once its age is counted: usually an aircraft
 * overhead, and the ground again once the aircraft has gone. Strength comes from a platoon in
 * a firefight with it, which counts the men shooting at it. Weapons come from everyone.
 */
export function fuse(entries: readonly Entry[], tick: number, plausibleSpeedMps: number): FusedTrack {
  const ranked = [...entries].sort(
    (a, b) =>
      uncertainty(a, tick, plausibleSpeedMps) - uncertainty(b, tick, plausibleSpeedMps) ||
      Number(b[1].viaAircraft) - Number(a[1].viaAircraft) ||
      b[1].contact.position.observedAt - a[1].contact.position.observedAt ||
      (a[0] < b[0] ? -1 : 1),
  );
  const [primaryKey, primary] = ranked[0] as Entry;
  const contacts = entries.map(([, entry]) => entry.contact);
  const inContact = entries
    .filter(([, entry]) => !entry.viaAircraft && entry.contact.activity === 'engaging' && tick - entry.contact.position.observedAt <= CONTACT_STRENGTH_SECONDS)
    .sort((a, b) => b[1].contact.position.observedAt - a[1].contact.position.observedAt)[0];
  const facing = [...contacts].sort((a, b) => b.position.observedAt - a.position.observedAt).find((c) => c.facingRad !== undefined)?.facingRad;
  const contact: ContactEstimate = {
    ...primary.contact,
    position: { ...primary.contact.position, ...weightedPosition(ranked, tick, plausibleSpeedMps) },
    identification: fusedIdentification(contacts, primary.contact.identification),
    strength: inContact?.[1].contact.strength ?? primary.contact.strength,
    observedWeapons: [...new Set(contacts.flatMap((c) => c.observedWeapons))].sort(),
    ...(facing === undefined ? {} : { facingRad: facing }),
  };
  const newestObservedAt = Math.max(...contacts.map((c) => c.position.observedAt));
  return {
    contact,
    primaryKey,
    viaAircraft: primary.viaAircraft,
    status: fusedStatus(entries, newestObservedAt),
    losses: claimsOf(entries).losses,
    newestObservedAt,
  };
}

/**
 * Where the track is, as a Gaussian update would put it: the comparable reports averaged, each
 * weighted by how precise it is now, so two good sightings that agree beat either one alone.
 */
function weightedPosition(ranked: readonly Entry[], tick: number, plausibleSpeedMps: number): Readonly<{ center: { x: number; y: number }; sigmaMeters: number }> {
  const best = uncertainty(ranked[0] as Entry, tick, plausibleSpeedMps);
  let [wx, wy, total] = [0, 0, 0];
  for (const entry of ranked) {
    const spread = Math.max(1, uncertainty(entry, tick, plausibleSpeedMps));
    if (spread > best * COMPARABLE_FACTOR) break;
    const weight = 1 / (spread * spread);
    wx += entry[1].contact.position.center.x * weight;
    wy += entry[1].contact.position.center.y * weight;
    total += weight;
  }
  const primary = (ranked[0] as Entry)[1].contact.position;
  // Agreeing reports tighten the estimate: the primary's error shrinks by as much as they add.
  const tightening = 1 / Math.sqrt(total) / Math.max(1, best);
  return { center: { x: wx / total, y: wy / total }, sigmaMeters: primary.sigmaMeters * Math.min(1, tightening) };
}

/** A firefight doesn't lie about sides: a hostile from a source in contact, or a confident one, wins. */
function fusedIdentification(contacts: readonly ContactEstimate[], primary: Identification): Identification {
  if (contacts.some((c) => c.identification === 'hostile' && (c.confidence !== 'low' || c.activity === 'engaging'))) return 'hostile';
  if (primary !== 'unidentified') return primary;
  return contacts.find((c) => c.identification !== 'unidentified')?.identification ?? 'unidentified';
}

/** Destroyed only if nobody has seen it since; not found only if every source looked and missed. */
function fusedStatus(entries: readonly Entry[], newestObservedAt: number): ContactStatus {
  if (entries.some(([, entry]) => entry.status === 'destroyed' && entry.statusAt >= newestObservedAt)) return 'destroyed';
  if (entries.every(([, entry]) => entry.status === 'not-found')) return 'not-found';
  return entries.some(([, entry]) => entry.status === 'hit' || entry.status === 'destroyed') ? 'hit' : 'active';
}

function entriesOf(player: PlayerKnowledge, track: TrackRecord, tick: number, archiveSeconds: number): Entry[] {
  return track.reports.flatMap((key): Entry[] => {
    const entry = player.contacts[key];
    if (entry === undefined || tick - entry.contact.position.observedAt > archiveSeconds) return [];
    return [[key, entry]];
  });
}

/** The track as it stands, or null once every report in it has gone stale enough to archive. */
export function trackEstimate(player: PlayerKnowledge, trackId: string, parameters: TrackParameters, tick: number): FusedTrack | null {
  const track = player.tracks[trackId];
  if (track === undefined) return null;
  const entries = entriesOf(player, track, tick, parameters.archiveSeconds);
  return entries.length === 0 ? null : fuse(entries, tick, parameters.plausibleSpeedMps);
}

/**
 * Puts each new report on a track. It joins the nearest live track it could belong to, by
 * position reachable at a plausible speed, compatible strength and no conflicting side. A
 * track already holding a different contact from the same source is ruled out: that source
 * could already tell them apart. Otherwise the report opens a new track.
 */
export function correlateReports(player: PlayerKnowledge, parameters: TrackParameters, tick: number): void {
  const fresh = Object.keys(player.contacts)
    .filter((key) => player.trackOf[key] === undefined)
    .sort();
  for (const key of fresh) {
    const entry = player.contacts[key];
    if (entry === undefined) continue;
    const { contact } = entry;
    const candidates = Object.values(player.tracks)
      .filter((track) => !track.reports.some((other) => sameSourceOtherContact(player, other, contact)))
      .flatMap((track) => {
        const fused = trackEstimate(player, track.id, parameters, tick);
        if (fused === null || fused.status === 'destroyed') return [];
        if (!withinGate(fused.contact, contact, parameters.plausibleSpeedMps)) return [];
        return [{ track, gap: distance(fused.contact.position.center, contact.position.center) }];
      })
      .sort((a, b) => a.gap - b.gap || a.track.number - b.track.number);
    const best = candidates[0];
    if (best !== undefined) {
      player.tracks[best.track.id] = { ...best.track, reports: [...best.track.reports, key], ambiguous: best.track.ambiguous || candidates.length > 1 };
      player.trackOf[key] = best.track.id;
      continue;
    }
    const number = FIRST_TRACK_NUMBER + player.nextTrackNumber;
    player.nextTrackNumber += 1;
    const id = `TN-${number}`;
    player.tracks[id] = { id, number, reports: [key], ambiguous: false, openedAt: tick, merged: [] };
    player.trackOf[key] = id;
  }
  mergeTracks(player, parameters, tick);
}

const MERGE_INTERVAL_TICKS = 5;

function sharesSource(player: PlayerKnowledge, a: TrackRecord, b: TrackRecord): boolean {
  const sources = (track: TrackRecord): Set<string> =>
    new Set(track.reports.flatMap((key) => {
      const source = player.contacts[key]?.contact.provenance.sourceId;
      return source === undefined ? [] : [source];
    }));
  const left = sources(a);
  return [...sources(b)].some((source) => left.has(source));
}

/**
 * Revisits earlier decisions, as a track manager does when the picture firms up. Two fresh
 * tracks that pass each other's gate, with no source that told them apart, are one group. A
 * stale track whose unit could have reached exactly one fresh track becomes that track; with
 * two or more candidates it stays where it was last seen, because guessing would be worse. The
 * older number survives and lists the one merged into it.
 */
export function mergeTracks(player: PlayerKnowledge, parameters: TrackParameters, tick: number): void {
  if (tick % MERGE_INTERVAL_TICKS !== 0) return;
  const live = Object.values(player.tracks)
    .sort((a, b) => a.number - b.number)
    .flatMap((track) => {
      const fused = trackEstimate(player, track.id, parameters, tick);
      return fused === null || fused.status === 'destroyed' ? [] : [{ track, fused, fresh: tick - fused.newestObservedAt < parameters.staleSeconds }];
    });
  const gone = new Set<string>();
  const merge = (keep: TrackRecord, drop: TrackRecord): void => {
    const kept = player.tracks[keep.id] ?? keep;
    player.tracks[keep.id] = { ...kept, reports: [...kept.reports, ...drop.reports], ambiguous: kept.ambiguous || drop.ambiguous, merged: [...kept.merged, drop.number, ...drop.merged] };
    for (const key of drop.reports) player.trackOf[key] = keep.id;
    delete player.tracks[drop.id];
    gone.add(drop.id);
  };
  const compatible = (a: (typeof live)[number], b: (typeof live)[number]): boolean =>
    withinGate(a.fused.contact, b.fused.contact, parameters.plausibleSpeedMps) &&
    !sharesSource(player, player.tracks[a.track.id] ?? a.track, player.tracks[b.track.id] ?? b.track);
  for (const [index, a] of live.entries()) {
    if (gone.has(a.track.id)) continue;
    const candidates = live.filter((b, other) => other !== index && !gone.has(b.track.id) && b.fresh && compatible(a, b));
    if (a.fresh) {
      for (const b of candidates.filter((b) => b.track.number > a.track.number)) merge(a.track, b.track);
    } else if (candidates.length === 1) {
      const [only] = candidates as [(typeof live)[number]];
      const [keep, drop] = a.track.number < only.track.number ? [a.track, only.track] : [only.track, a.track];
      merge(keep, drop);
    }
  }
}

function sameSourceOtherContact(player: PlayerKnowledge, key: string, contact: ContactEstimate): boolean {
  const other = player.contacts[key]?.contact;
  return other !== undefined && other.provenance.sourceId === contact.provenance.sourceId && other.contactId !== contact.contactId;
}

/**
 * Whether a report could be the unit a track describes. Wider than the strict test used to
 * close reports: estimates from different sources err independently, and a squad near the edge
 * of a size band is often put in the next one. A report of several squads as one group joins
 * only a track of comparable size.
 */
export function withinGate(track: ContactEstimate, report: ContactEstimate, plausibleSpeedMps: number): boolean {
  if (track.identification !== 'unidentified' && report.identification !== 'unidentified' && track.identification !== report.identification) {
    return false;
  }
  const elapsed = Math.abs(report.position.observedAt - track.position.observedAt);
  const gate = GATE_SIGMAS * hypot(track.position.sigmaMeters, report.position.sigmaMeters) + elapsed * plausibleSpeedMps + GATE_FLOOR_METERS;
  if (distance(track.position.center, report.position.center) > gate) return false;
  const factor = (track.grouped === true) === (report.grouped === true) ? STRENGTH_FACTOR : 1;
  return strengthsAgree(track.strength, report.strength, factor);
}

function strengthsAgree(a: StrengthEstimate, b: StrengthEstimate, factor: number): boolean {
  if (a.kind === 'unknown' || b.kind === 'unknown') return true;
  return Math.max(a.min, b.min) <= factor * Math.min(a.max, b.max);
}
