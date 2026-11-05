import { atan2, PI } from '../domain/public/det-math';
import type { ContactEstimate } from '../domain/public/estimates';
import type { FireIntensity } from '../domain/public/fire';
import type { Vec2 } from '../domain/public/geometry';
import type { FireEndRef, PlayerKnowledge } from './player-knowledge';

/*
 * Fire on the controller's map (§7.3), built only from what crews saw and units reported.
 * A line a crew saw is solid; a line a unit reported is dashed. Fire nobody saw or reported,
 * such as enemy shooting at enemy, never shows.
 */

/** One end of a fire line: a friendly platoon, or a contact drawn as the marker that holds it. */
export type FireEnd = Readonly<
  { kind: 'friendly'; unitId: string; position: Vec2 } | { kind: 'contact'; key: string; position: Vec2; onMap: boolean }
>;

export type FireLine = Readonly<{
  /** The shooter, or null when only the direction it fires from is known. */
  from: FireEnd | null;
  /** Whom the fire lands on, or null when only its direction is known. */
  to: FireEnd | null;
  /** Direction of fire, from shooter toward target. */
  bearingRad: number;
  /** Above zero for fire from a direction only: the half-width of the wedge. */
  spreadRad: number;
  /** Seen by a crew, rather than reported by a unit. */
  seen: boolean;
  reportedBy: string;
  heavy: boolean;
  ageSeconds: number;
  opacity: number;
}>;

/** A friendly unit's own word that it is under fire, or a crew's sight of fire landing on it. */
export type UnderFire = Readonly<{ intensity: FireIntensity; sinceAt: number | null; ageSeconds: number; opacity: number }>;

export type FireDisplay = Readonly<{ opacityFloor: number; fireLineFreshSeconds: number; fireLineSeconds: number }>;

/** Where a contact report shows on the map: the marker holding it, keyed by track or report. */
export type MarkerLookup = (reportKey: string) => Readonly<{ key: string; position: Vec2 }> | null;

export function fireOpacity(ageSeconds: number, display: FireDisplay): number {
  if (ageSeconds <= display.fireLineFreshSeconds) return 1;
  const fade = 1 - (ageSeconds - display.fireLineFreshSeconds) / (display.fireLineSeconds - display.fireLineFreshSeconds);
  return Math.max(display.opacityFloor, Math.min(1, fade));
}

const bearing = (from: Vec2, to: Vec2): number => atan2(to.y - from.y, to.x - from.x);
const reportKey = (contact: ContactEstimate): string => `${contact.provenance.sourceId}/${contact.contactId}`;

function contactEnd(contact: ContactEstimate, key: string, lookup: MarkerLookup): FireEnd {
  const marker = lookup(key);
  return marker === null
    ? { kind: 'contact', key, position: contact.position.center, onMap: false }
    : { kind: 'contact', key: marker.key, position: marker.position, onMap: true };
}

function endOf(player: PlayerKnowledge, ref: FireEndRef, lookup: MarkerLookup): FireEnd | null {
  if (ref.kind === 'contact') return contactEnd(ref.contact, ref.key, lookup);
  const friendly = player.friendlies[ref.unitId];
  return friendly === undefined ? null : { kind: 'friendly', unitId: ref.unitId, position: friendly.position.center };
}

const endKey = (end: FireEnd | null): string => (end === null ? '?' : end.kind === 'friendly' ? `friendly/${end.unitId}` : end.key);

export function fireLines(player: PlayerKnowledge, lookup: MarkerLookup, tick: number, display: FireDisplay): readonly FireLine[] {
  const lines = new Map<string, FireLine>();
  const add = (line: FireLine): void => {
    if (line.ageSeconds > display.fireLineSeconds) return;
    const key = `${endKey(line.from)}>${endKey(line.to)}${line.from === null ? `@${line.bearingRad.toFixed(2)}` : ''}`;
    const known = lines.get(key);
    // What a crew saw outranks what a unit said, and fresher outranks older.
    if (known === undefined || (line.seen && !known.seen) || (line.seen === known.seen && line.ageSeconds < known.ageSeconds)) lines.set(key, line);
  };

  for (const unitId of Object.keys(player.unitFire).sort()) {
    const report = player.unitFire[unitId];
    const friendly = player.friendlies[unitId];
    if (report === undefined) continue;
    const position = friendly?.position.center ?? report.ownPosition.center;
    const self: FireEnd = { kind: 'friendly', unitId, position };
    const { status } = report;
    const heavy = status.intensity === 'heavy';
    const ageSeconds = tick - report.observedAt;
    const opacity = fireOpacity(ageSeconds, display);
    const base = { seen: false, reportedBy: unitId, heavy, ageSeconds, opacity };
    for (const incoming of status.from) {
      if (incoming.contact === null) {
        add({ ...base, from: null, to: self, bearingRad: incoming.bearingRad + PI, spreadRad: incoming.spreadRad });
      } else {
        const from = contactEnd(incoming.contact, reportKey(incoming.contact), lookup);
        add({ ...base, from, to: self, bearingRad: bearing(from.position, position), spreadRad: 0 });
      }
    }
    for (const contact of status.engaging) {
      const to = contactEnd(contact, reportKey(contact), lookup);
      add({ ...base, heavy: false, from: self, to, bearingRad: bearing(position, to.position), spreadRad: 0 });
    }
  }

  for (const shooter of Object.keys(player.seenFire).sort()) {
    const seen = player.seenFire[shooter];
    if (seen === undefined) continue;
    const from = endOf(player, seen.from, lookup);
    if (from === null) continue;
    const to = seen.to === null ? null : endOf(player, seen.to, lookup);
    const ageSeconds = tick - seen.seenAt;
    add({
      from,
      to,
      bearingRad: to === null ? seen.bearingRad : bearing(from.position, to.position),
      spreadRad: 0,
      seen: true,
      reportedBy: seen.aircraftId,
      heavy: false,
      ageSeconds,
      opacity: fireOpacity(ageSeconds, display),
    });
  }
  return [...lines.values()];
}

/** Friendly units known to be under fire: by their own word, or because a crew saw fire land on them. */
export function underFire(player: PlayerKnowledge, lines: readonly FireLine[], tick: number, display: FireDisplay): Readonly<Record<string, UnderFire>> {
  const result: Record<string, UnderFire> = {};
  for (const unitId of Object.keys(player.unitFire).sort()) {
    const report = player.unitFire[unitId];
    if (report === undefined || !report.status.underFire) continue;
    const ageSeconds = tick - report.observedAt;
    if (ageSeconds > display.fireLineSeconds) continue;
    result[unitId] = { intensity: report.status.intensity, sinceAt: report.status.since, ageSeconds, opacity: fireOpacity(ageSeconds, display) };
  }
  for (const line of lines) {
    if (!line.seen || line.to?.kind !== 'friendly') continue;
    const known = result[line.to.unitId];
    if (known === undefined || known.ageSeconds > line.ageSeconds) {
      result[line.to.unitId] = { intensity: known?.intensity ?? 'light', sinceAt: known?.sinceAt ?? null, ageSeconds: line.ageSeconds, opacity: line.opacity };
    }
  }
  return result;
}
