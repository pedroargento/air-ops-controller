// What should stop a fast run: the things a controller would want to be woken for. Each is a
// key, and a run stops when a key appears that wasn't there before, so a standing condition
// (an aircraft already on station, a request already seen) doesn't stop it again.
import { AIR_OPS, CECON, reportLevel } from '../domain/public/radio';
import type { PlayerView } from '../knowledge/player-view';

export function attentionKeys(view: PlayerView): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const aircraft of view.aircraft) {
    const airborne = aircraft.status === 'enroute' || aircraft.status === 'onStation';
    if (aircraft.status === 'onStation') keys.add(`on-station:${aircraft.aircraftId}`);
    if (aircraft.landed) keys.add(`landed:${aircraft.aircraftId}`);
    if (aircraft.damaged) keys.add(`damaged:${aircraft.aircraftId}`);
    if (airborne && aircraft.aircraftType === 'cas' && aircraft.ammunition === 0 && aircraft.gunBursts === 0) keys.add(`out-of-ordnance:${aircraft.aircraftId}`);
  }
  for (const request of view.supportRequests) {
    if (request.answer === null) keys.add(`request:${request.unitId}`);
    if (request.dangerClose && request.dangerCloseUntil === null) keys.add(`danger-close:${request.unitId}`);
  }
  for (const request of view.medevacRequests) {
    if (request.answer === null) keys.add(`medevac:${request.unitId}`);
  }
  if (view.contacts.length > 0) keys.add('first-contact');
  return keys;
}

/** Anything urgent or main from a unit or an aircraft since `logBefore`. */
export function radioNeedsAttention(logBefore: number, view: PlayerView): boolean {
  return view.log.slice(logBefore).some((message) => message.senderId !== CECON && message.senderId !== AIR_OPS && reportLevel(message) !== 'routine');
}

/** True when something new needs the controller since `before`, or the radio carried more than routine traffic. */
export function needsAttention(before: ReadonlySet<string>, logBefore: number, view: PlayerView): boolean {
  for (const key of attentionKeys(view)) {
    if (!before.has(key)) return true;
  }
  return radioNeedsAttention(logBefore, view);
}
