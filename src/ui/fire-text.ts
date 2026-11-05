import type { ContactMarker, FireEnd, FireLine, PlayerView } from '../knowledge/player-view';
import { clock, compassDirection } from './format';

/*
 * Fire in words, for the panels, the track list and request cards (§7.3). Only what crews saw
 * and units reported, the same as the map's fire lines.
 */

type Name = (id: string) => string;

function markerFor(view: PlayerView, key: string): ContactMarker | undefined {
  return view.contacts.find((marker) => marker.key === key);
}

/** "TN 4003", or "a contact near 049-037" for one not on the map. */
export function endText(view: PlayerView, end: FireEnd, name: Name, grid: (point: FireEnd['position']) => string): string {
  if (end.kind === 'friendly') return name(end.unitId);
  const marker = end.onMap ? markerFor(view, end.key) : undefined;
  if (marker?.trackNumber !== null && marker?.trackNumber !== undefined) return `TN ${marker.trackNumber}`;
  return `a contact near ${grid(end.position)}`;
}

/** Lines touching a friendly unit or a contact marker. */
function linesAt(view: PlayerView, test: (end: FireEnd | null) => boolean): readonly FireLine[] {
  return view.fire.filter((line) => test(line.from) || test(line.to)).sort((a, b) => a.ageSeconds - b.ageSeconds);
}

const isFriendly = (unitId: string) => (end: FireEnd | null): boolean => end?.kind === 'friendly' && end.unitId === unitId;
const isContact = (key: string) => (end: FireEnd | null): boolean => end?.kind === 'contact' && end.key === key;

/** "TN 4001, TN 4004 and 2 contacts off the tracks", from the ends' own words. */
function listEnds(texts: readonly string[]): string {
  const named = [...new Set(texts.filter((text) => !text.startsWith('a contact near')))];
  const loose = texts.filter((text) => text.startsWith('a contact near')).length;
  const parts = [...named, ...(loose === 0 ? [] : [loose === 1 && named.length === 0 ? (texts.find((text) => text.startsWith('a contact near')) as string) : `${loose} ${loose === 1 ? 'contact' : 'contacts'} not on a track`])];
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "from TN 4001 (seen from the air); from TN 4004 and the north-east (reported)" */
function bySource(lines: readonly FireLine[], text: (line: FireLine) => string): string {
  const groups = (['seen', 'reported'] as const).flatMap((kind) => {
    const chosen = lines.filter((line) => line.seen === (kind === 'seen'));
    return chosen.length === 0 ? [] : [`${listEnds(chosen.map(text))} (${kind === 'seen' ? 'seen from the air' : 'reported'})`];
  });
  return groups.join('; ');
}

/** A friendly unit's fight: under fire, from where, and what it is engaging. Empty when there's none. */
export function friendlyFireLines(view: PlayerView, unitId: string, name: Name, grid: (point: FireEnd['position']) => string): readonly string[] {
  const marker = view.friendlies.find((entry) => entry.unitId === unitId);
  const lines = linesAt(view, isFriendly(unitId));
  const out: string[] = [];
  const under = marker?.underFire ?? null;
  if (under !== null) {
    out.push(`${under.intensity === 'heavy' ? 'Under heavy fire' : 'Under fire'}${under.sinceAt === null ? '' : ` since ${clock(under.sinceAt)}`}, as of ${clock(view.tick - under.ageSeconds)}.`);
  }
  const from = lines.filter((line) => line.to !== null && isFriendly(unitId)(line.to));
  if (from.length > 0) {
    out.push(`Taking fire from ${bySource(from, (line) => (line.from === null ? `the ${compassDirection(line.bearingRad - Math.PI)}` : endText(view, line.from, name, grid)))}.`);
  }
  const targets = lines.filter((line) => line.from !== null && isFriendly(unitId)(line.from) && line.to !== null);
  if (targets.length > 0) out.push(`Engaging ${bySource(targets, (line) => endText(view, line.to as FireEnd, name, grid))}.`);
  return out;
}

/** Whom a track is firing on, and who is firing on it. */
export function contactFireLines(view: PlayerView, key: string, name: Name, grid: (point: FireEnd['position']) => string): readonly string[] {
  const lines = linesAt(view, isContact(key));
  const out: string[] = [];
  const on = lines.filter((line) => isContact(key)(line.from));
  if (on.length > 0) {
    out.push(`Firing on ${bySource(on, (line) => (line.to === null ? `something to the ${compassDirection(line.bearingRad)}` : endText(view, line.to, name, grid)))}.`);
  }
  const by = lines.filter((line) => isContact(key)(line.to) && line.from !== null);
  if (by.length > 0) out.push(`Engaged by ${bySource(by, (line) => endText(view, line.from as FireEnd, name, grid))}.`);
  return out;
}

/** Friendly units a track is firing on, by reports or sight, for sorting the track list. */
export function friendsFiredOn(view: PlayerView, key: string): number {
  const units = new Set<string>();
  for (const line of view.fire) {
    if (isContact(key)(line.from) && line.to?.kind === 'friendly') units.add(line.to.unitId);
  }
  return units.size;
}
