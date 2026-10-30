import type { ContactEstimate, PositionEstimate } from '../domain/public/estimates';
import type { Vec2 } from '../domain/public/geometry';
import type { RadioMessage } from '../domain/public/radio';

export type PositionSource = 'self-report' | 'aircraft';

export type FriendlyMarker = Readonly<{
  unitId: string;
  position: PositionEstimate;
  source: PositionSource;
  receivedAt: number;
}>;

export type Discrepancy = Readonly<{
  unitId: string;
  kept: PositionEstimate;
  conflicting: PositionEstimate;
  recordedAt: number;
}>;

export type PlayerContact = Readonly<{
  contact: ContactEstimate;
  receivedAt: number;
  viaAircraft: boolean;
}>;

export type SupportRequest = Readonly<{
  unitId: string;
  position: PositionEstimate;
  receivedAt: number;
  acknowledged: boolean;
}>;

export type TicFlag = Readonly<{ unitId: string; position: PositionEstimate; receivedAt: number }>;

export type StrikeMark = Readonly<{
  aircraftId: string;
  position: Vec2;
  tick: number;
  effectObserved: boolean;
}>;

export type PlayerKnowledge = {
  log: RadioMessage[];
  strikes: StrikeMark[];
  // When an aircraft last saw each friendly unit fighting.
  friendlyEngagedAt: Record<string, number>;
  contacts: Record<string, PlayerContact>;
  friendlies: Record<string, FriendlyMarker>;
  discrepancies: Discrepancy[];
  supportRequests: Record<string, SupportRequest>;
  ticFlags: Record<string, TicFlag>;
};

export function emptyPlayerKnowledge(): PlayerKnowledge {
  return {
    log: [],
    strikes: [],
    friendlyEngagedAt: {},
    contacts: {},
    friendlies: {},
    discrepancies: [],
    supportRequests: {},
    ticFlags: {},
  };
}

const isMoreReliable = (a: PositionEstimate, b: PositionEstimate): boolean => a.sigmaMeters < b.sigmaMeters;

/**
 * Evidence rule (§7): a newer report updates the marker, unless a comparably recent,
 * more reliable aircraft observation disagrees. The disagreement is recorded, not dropped.
 */
export function updateFriendly(
  player: PlayerKnowledge,
  unitId: string,
  position: PositionEstimate,
  source: PositionSource,
  receivedAt: number,
  comparableSeconds: number,
): void {
  const current = player.friendlies[unitId];
  if (current !== undefined) {
    if (position.observedAt < current.position.observedAt) return;
    const age = position.observedAt - current.position.observedAt;
    const aircraftOutranks =
      current.source === 'aircraft' &&
      source === 'self-report' &&
      age <= comparableSeconds &&
      isMoreReliable(current.position, position);
    if (aircraftOutranks) {
      player.discrepancies.push({ unitId, kept: current.position, conflicting: position, recordedAt: receivedAt });
      return;
    }
  }
  player.friendlies[unitId] = { unitId, position, source, receivedAt };
}

/** A new observation supersedes older ones within the same source track only. */
export function updateContact(player: PlayerKnowledge, contact: ContactEstimate, receivedAt: number, viaAircraft: boolean): void {
  const key = `${contact.provenance.sourceId}/${contact.contactId}`;
  const existing = player.contacts[key];
  if (existing !== undefined && contact.position.observedAt < existing.contact.position.observedAt) return;
  player.contacts[key] = { contact, receivedAt, viaAircraft };
}

/** Applies a message delivered to air operations. Ground reports count only from delivery. */
export function receiveByPlayer(player: PlayerKnowledge, message: RadioMessage, comparableSeconds: number): void {
  player.log.push(message);
  const friendly = (position: PositionEstimate): void =>
    updateFriendly(player, message.senderId, position, 'self-report', message.receivedAt, comparableSeconds);

  switch (message.kind) {
    case 'POSITION_REPORT':
      friendly(message.position);
      return;
    case 'CONTACT_REPORT':
      updateContact(player, message.contact, message.receivedAt, false);
      return;
    case 'TIC':
      friendly(message.ownPosition);
      player.ticFlags[message.senderId] = {
        unitId: message.senderId,
        position: message.ownPosition,
        receivedAt: message.receivedAt,
      };
      if (message.contact !== null) updateContact(player, message.contact, message.receivedAt, false);
      return;
    case 'SITREP':
      friendly(message.ownPosition);
      return;
    case 'SUPPORT_REQUEST':
      friendly(message.ownPosition);
      player.supportRequests[message.senderId] = {
        unitId: message.senderId,
        position: message.ownPosition,
        receivedAt: message.receivedAt,
        acknowledged: false,
      };
      return;
    case 'COMMAND_UPDATE':
    case 'ACKNOWLEDGEMENT':
    case 'INTEL_REPORT':
    case 'STRIKE_RESULT':
      return;
  }
}
