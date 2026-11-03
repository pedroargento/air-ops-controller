import type { AircraftTelemetryEntry } from '../domain/public/air';
import { distance, type Vec2 } from '../domain/public/geometry';
import type { PlayerView } from '../knowledge/player-view';
import { BREVITY } from './map-conventions';

/*
 * What the controller can do about a support request, and what came of it: the decisions
 * behind the request cards, kept apart from drawing so they can be tested.
 */

export type SupportRequestView = PlayerView['supportRequests'][number];

export type SupportOption = Readonly<{
  aircraftId: string;
  available: boolean;
  /** Seconds to arrive over the requester, if it went now. */
  etaSeconds: number | null;
  /** Why it can't go, in a few words. */
  reason: string | null;
}>;

/** Answered requests stay on the board this long, so the player sees what came of them. */
export const ANSWERED_SHOW_SECONDS = 600;

/** How long a strike aircraft would take to get over a point from where it is now. */
export function etaTo(aircraft: AircraftTelemetryEntry, point: Vec2): number {
  return aircraft.takeoffSeconds + distance(aircraft.position, point) / aircraft.speedMps;
}

/** Every strike aircraft, with how soon it could be there or why it can't go. */
export function supportOptions(request: SupportRequestView, aircraft: readonly AircraftTelemetryEntry[], clock: (tick: number) => string, tick: number): readonly SupportOption[] {
  return aircraft
    .filter((entry) => entry.aircraftType === 'cas')
    .map((entry): SupportOption => {
      const point = request.position.center;
      const unavailable = (reason: string): SupportOption => ({ aircraftId: entry.aircraftId, available: false, etaSeconds: null, reason });
      if (entry.damaged) return unavailable(`damaged, repaired by ${clock(tick + entry.availableInSeconds)}`);
      if (entry.status === 'turnaround') return unavailable(`rearming until ${clock(tick + entry.availableInSeconds)}`);
      if (entry.status === 'returning') return unavailable(`returning to base, ready about ${clock(tick + entry.availableInSeconds)}`);
      if (entry.ammunition <= 0 && entry.gunBursts <= 0) return unavailable('nothing left to fire');
      return { aircraftId: entry.aircraftId, available: true, etaSeconds: etaTo(entry, point), reason: null };
    })
    .sort((a, b) => Number(b.available) - Number(a.available) || (a.etaSeconds ?? 0) - (b.etaSeconds ?? 0) || (a.aircraftId < b.aircraftId ? -1 : 1));
}

/** Where the request stands, in one line: what was answered and what the aircraft is doing now. */
export function requestStatus(request: SupportRequestView, aircraft: readonly AircraftTelemetryEntry[], clock: (tick: number) => string, tick: number): string {
  const { answer } = request;
  if (answer === null) return 'Waiting for your answer.';
  switch (answer.kind) {
    case 'none':
      return `Told no air is available (${clock(answer.answeredAt)}).`;
    case 'cancelled':
      return `${answer.aircraftId} was given something else, so the promise was called off and the unit told (${clock(answer.answeredAt)}).`;
    case 'inbound': {
      const entry = aircraft.find((candidate) => candidate.aircraftId === answer.aircraftId);
      if (entry?.status === 'onStation') {
        const doing = entry.casPhase === null ? 'on station' : BREVITY[entry.casPhase];
        return `${answer.aircraftId} is over them: ${doing}.`;
      }
      const left = Math.max(0, answer.etaAt - tick);
      return `${answer.aircraftId} inbound, ETA ${clock(answer.etaAt)} (in ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}).`;
    }
  }
}

/** A request stays on the board until it's answered and settled, or while danger close is open. */
export function showRequest(request: SupportRequestView, aircraft: readonly AircraftTelemetryEntry[], tick: number): boolean {
  if (request.answer === null || request.dangerClose || request.dangerCloseUntil !== null) return true;
  if (tick - request.answer.answeredAt <= ANSWERED_SHOW_SECONDS) return true;
  const answer = request.answer;
  return answer.kind === 'inbound' && aircraft.find((entry) => entry.aircraftId === answer.aircraftId)?.status !== 'onStation';
}
