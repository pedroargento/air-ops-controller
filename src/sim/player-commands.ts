import { POI_KINDS, type Poi } from '../domain/public/poi';
import {
  qualifiesForSupport,
  type AircraftId,
  type AircraftTelemetry,
  type AircraftTelemetryEntry,
} from '../domain/public/air';
import type { PlayerCommand, ReportRequest } from '../domain/public/commands';
import type { Vec2 } from '../domain/public/geometry';
import { emptyKnowledge, type ContactId, type UnitKnowledge } from '../domain/public/ground';
import {
  AIR_OPS,
  type ExpectedSupport,
  type MessageId,
  type RadioMessage,
  type ReportNeed,
  type Suppression,
} from '../domain/public/radio';
import type { Aircraft } from '../domain/truth/world';
import type { ContactEstimate } from '../domain/public/estimates';
import { trackEstimate } from '../knowledge/tracks';
import { receiveByUnit } from '../knowledge/unit-knowledge';
import type { RequestAnswer } from '../knowledge/player-knowledge';
import type { Scenario } from '../scenario/load';
import { aircraftTelemetry, applyOrder, setTargetAltitude } from './air';
import { enqueue, linkedNodes, type PendingTransmission, type RadioState } from './radio';
import type { SimState } from './state';

const REQUEST_PRIORITY = -1;

function nextId(radio: RadioState): MessageId {
  radio.nextMessageNumber += 1;
  return `M-${radio.nextMessageNumber}` as MessageId;
}

function canReach(scenario: Scenario, unitId: string): boolean {
  return linkedNodes(scenario, AIR_OPS).includes(unitId);
}

function qualifyingSupport(
  entry: AircraftTelemetryEntry | undefined,
  reported: Vec2 | undefined,
  scenario: Scenario,
): boolean {
  return qualifiesForSupport(entry, reported, scenario.file.air.supportAckDistanceMeters);
}

function supportFor(entry: AircraftTelemetryEntry, tick: number, scenario: Scenario): ExpectedSupport {
  const etaAt = tick + Math.ceil(entry.etaSeconds ?? 0);
  return { aircraftId: entry.aircraftId, etaAt, lapsesAt: etaAt + scenario.file.air.supportGraceSeconds };
}

function acknowledgement(
  state: SimState,
  scenario: Scenario,
  support: ExpectedSupport | null,
  supportCancelled: boolean,
): RadioMessage {
  const tick = state.tick;
  return {
    id: nextId(state.radio),
    kind: 'ACKNOWLEDGEMENT',
    senderId: AIR_OPS,
    observedAt: tick,
    sentAt: tick,
    receivedAt: tick + scenario.file.radio.transmitSeconds,
    support,
    supportCancelled,
  };
}

function transmit(state: SimState, scenario: Scenario, transmission: PendingTransmission['payload']): void {
  state.radio.outbound.push({
    deliverAt: state.tick + scenario.file.radio.transmitSeconds,
    payload: transmission,
  });
}

function acknowledge(
  state: SimState,
  scenario: Scenario,
  telemetry: AircraftTelemetry,
  unitId: string,
  casAircraftId: AircraftId | null,
): void {
  if (!canReach(scenario, unitId)) return;
  let support: ExpectedSupport | null = null;
  if (casAircraftId !== null) {
    const entry = telemetry.find((aircraft) => aircraft.aircraftId === casAircraftId);
    const reported = state.player.friendlies[unitId]?.position.center;
    if (entry === undefined || !qualifyingSupport(entry, reported, scenario)) return;
    support = supportFor(entry, state.tick, scenario);
    state.radio.promises[unitId] = support;
  }
  const request = state.player.supportRequests[unitId];
  const answer: RequestAnswer =
    support === null
      ? { kind: 'none', answeredAt: state.tick }
      : { kind: 'inbound', aircraftId: support.aircraftId, etaAt: support.etaAt, answeredAt: state.tick };
  if (request !== undefined) state.player.supportRequests[unitId] = { ...request, acknowledged: true, answer };
  transmit(state, scenario, { kind: 'message', recipient: unitId, message: acknowledgement(state, scenario, support, false) });
}

/** What the controller would read out for a map marker: a track as fused, or a single report. */
function forwardedEstimate(state: SimState, scenario: Scenario, key: string): ContactEstimate | null {
  if (state.player.tracks[key] !== undefined) return trackEstimate(state.player, key, scenario.file.display, state.tick)?.contact ?? null;
  return state.player.contacts[key]?.contact ?? null;
}

function forwardContact(state: SimState, scenario: Scenario, contactKey: string, recipients: readonly string[]): void {
  const contact = forwardedEstimate(state, scenario, contactKey);
  if (contact === null) return;
  const entry = { contact };
  const { tick } = state;
  for (const recipient of [...new Set(recipients)].sort()) {
    if (!canReach(scenario, recipient)) continue;
    const message: RadioMessage = {
      id: nextId(state.radio),
      kind: 'INTEL_REPORT',
      senderId: AIR_OPS,
      observedAt: entry.contact.position.observedAt,
      sentAt: tick,
      receivedAt: tick + scenario.file.radio.transmitSeconds,
      contact: entry.contact,
    };
    transmit(state, scenario, { kind: 'message', recipient, message });
  }
}

function sendPoi(state: SimState, scenario: Scenario, poi: Poi, cancelled: boolean): void {
  const { tick } = state;
  for (const recipient of poi.recipients) {
    const message: RadioMessage = {
      id: nextId(state.radio),
      kind: 'POI_REPORT',
      senderId: AIR_OPS,
      observedAt: tick,
      sentAt: tick,
      receivedAt: tick + scenario.file.radio.transmitSeconds,
      poi,
      cancelled,
    };
    transmit(state, scenario, { kind: 'message', recipient, message });
  }
}

function reportPoi(state: SimState, scenario: Scenario, command: Extract<PlayerCommand, { kind: 'reportPoi' }>): void {
  if (POI_KINDS[command.poiKind] === undefined || command.radiusMeters <= 0) return;
  const recipients = [...new Set(command.recipients)].sort().filter((recipient) => canReach(scenario, recipient));
  if (recipients.length === 0) return;
  state.radio.nextMessageNumber += 1;
  const poi: Poi = {
    id: `P-${state.radio.nextMessageNumber}`,
    kind: command.poiKind,
    center: command.center,
    radiusMeters: command.radiusMeters,
    placedAt: state.tick,
    recipients,
  };
  state.player.pois.push(poi);
  sendPoi(state, scenario, poi, false);
}

function cancelPoi(state: SimState, scenario: Scenario, poiId: string): void {
  const poi = state.player.pois.find((entry) => entry.id === poiId);
  if (poi === undefined) return;
  state.player.pois = state.player.pois.filter((entry) => entry !== poi);
  sendPoi(state, scenario, poi, true);
}

/**
 * Air operations puts a suppression mission on the net, so platoons know when a position will
 * have its head down, and calls it off when the aircraft is given something else (§8.0).
 */
function announceSuppression(state: SimState, scenario: Scenario, aircraft: Aircraft, before: Aircraft['order']): void {
  const order = aircraft.order;
  const suppressing = order?.kind === 'Suppress';
  if (!suppressing && before?.kind !== 'Suppress') return;
  const entry = aircraftTelemetry(state.truth, scenario.file.air, state.tick).find((candidate) => candidate.aircraftId === aircraft.id);
  const recipients = Object.values(state.truth.platoons)
    .filter((platoon) => platoon.side === 'friendly' && canReach(scenario, platoon.id))
    .map((platoon) => platoon.id as string)
    .sort();
  const suppression: Suppression = suppressing
    ? {
        aircraftId: aircraft.id,
        center: order.center,
        radius: order.radius,
        fromTick: state.tick + Math.ceil(entry?.etaSeconds ?? 0),
        untilTick: order.untilTick,
      }
    : { aircraftId: aircraft.id, center: before?.kind === 'Suppress' ? before.center : aircraft.position, radius: 0, fromTick: state.tick, untilTick: state.tick };
  for (const recipient of recipients) {
    const message: RadioMessage = {
      id: nextId(state.radio),
      kind: 'SUPPRESSION',
      senderId: AIR_OPS,
      observedAt: state.tick,
      sentAt: state.tick,
      receivedAt: state.tick + scenario.file.radio.transmitSeconds,
      suppression,
      cancelled: !suppressing,
    };
    transmit(state, scenario, { kind: 'message', recipient, message });
  }
}

/**
 * Clearing it is the controller's call, and only on a unit's own request (§8.1.1). Denying a
 * clearance already given revokes it at once.
 */
function answerDangerClose(state: SimState, scenario: Scenario, unitId: string, approved: boolean): void {
  if (!approved) delete state.player.dangerCloseClearedUntil[unitId];
  const request = state.player.supportRequests[unitId];
  if (request === undefined || !request.dangerClose) return;
  state.player.supportRequests[unitId] = { ...request, dangerClose: false };
  if (approved) state.player.dangerCloseClearedUntil[unitId] = state.tick + scenario.file.air.dangerCloseClearanceSeconds;
}

function aircraftById(aircraft: readonly Aircraft[], id: AircraftId): Aircraft | undefined {
  return aircraft.find((entry) => entry.id === id);
}

/** Commands are validated here. An invalid command has no effect. */
export function applyCommand(state: SimState, command: PlayerCommand, scenario: Scenario): void {
  switch (command.kind) {
    case 'noop':
      return;
    case 'aircraftOrder': {
      const aircraft = aircraftById(state.truth.aircraft, command.aircraftId);
      if (aircraft === undefined) return;
      const before = aircraft.order;
      if (!applyOrder(aircraft, command.order, scenario.file.air)) return;
      announceSuppression(state, scenario, aircraft, before);
      return;
    }
    case 'setAltitude': {
      const aircraft = aircraftById(state.truth.aircraft, command.aircraftId);
      if (aircraft !== undefined) setTargetAltitude(aircraft, command.meters, scenario.file.air);
      return;
    }
    case 'releaseAltitude': {
      const aircraft = aircraftById(state.truth.aircraft, command.aircraftId);
      if (aircraft !== undefined) aircraft.manualAltitude = false;
      return;
    }
    case 'setRisk': {
      const aircraft = aircraftById(state.truth.aircraft, command.aircraftId);
      if (aircraft !== undefined) aircraft.risk = command.risk;
      return;
    }
    case 'setWeapons': {
      const aircraft = aircraftById(state.truth.aircraft, command.aircraftId);
      if (aircraft !== undefined) aircraft.weapons = command.weapons;
      return;
    }
    case 'answerDangerClose':
      answerDangerClose(state, scenario, command.unitId, command.approved);
      return;
    case 'reportPoi':
      reportPoi(state, scenario, command);
      return;
    case 'cancelPoi':
      cancelPoi(state, scenario, command.poiId);
      return;
    case 'forwardContact':
      forwardContact(state, scenario, command.contactKey, command.recipients);
      return;
    case 'requestReport':
      if (canReach(scenario, command.unitId)) {
        transmit(state, scenario, { kind: 'request', unitId: command.unitId, report: command.report });
      }
      return;
    case 'acknowledge':
      acknowledge(state, scenario, aircraftTelemetry(state.truth, scenario.file.air, state.tick), command.unitId, command.casAircraftId);
      return;
  }
}

function needFor(report: ReportRequest): ReportNeed {
  switch (report) {
    case 'position':
      return { kind: 'POSITION_REPORT', contactId: null };
    case 'sitrep':
      return { kind: 'SITREP', contactId: null };
    case 'contact':
      return { kind: 'CONTACT_REPORT', contactId: null as ContactId | null };
  }
}

function deliverOutbound(
  transmission: PendingTransmission,
  knowledge: Record<string, UnitKnowledge>,
  radio: RadioState,
  tick: number,
): void {
  const { payload } = transmission;
  if (payload.kind === 'request') {
    const unitRadio = radio.units[payload.unitId];
    if (unitRadio !== undefined) enqueue(unitRadio, needFor(payload.report), tick, REQUEST_PRIORITY);
    return;
  }
  receiveByUnit((knowledge[payload.recipient] ??= emptyKnowledge()), payload.message);
  const unitRadio = radio.units[payload.recipient];
  if (unitRadio !== undefined && payload.message.kind === 'ACKNOWLEDGEMENT') {
    unitRadio.memory = { ...unitRadio.memory, supportAcknowledgedAt: tick };
  }
}

export function advanceOutbound(state: SimState): void {
  const { radio, tick } = state;
  const due = radio.outbound.filter((transmission) => transmission.deliverAt <= tick);
  if (due.length === 0) return;
  radio.outbound = radio.outbound.filter((transmission) => transmission.deliverAt > tick);
  for (const transmission of due) deliverOutbound(transmission, state.unitKnowledge, radio, tick);
}

/** Keeps `CAS inbound` honest: a changed assignment sends a correction, which takes time to arrive. */
export function reviewPromises(state: SimState, scenario: Scenario): void {
  const telemetry = aircraftTelemetry(state.truth, scenario.file.air, state.tick);
  const { promises } = state.radio;
  for (const unitId of Object.keys(promises).sort()) {
    const promise = promises[unitId];
    if (promise === undefined) continue;
    const entry = telemetry.find((aircraft) => aircraft.aircraftId === promise.aircraftId);
    const reported = state.player.friendlies[unitId]?.position.center;
    const request = state.player.supportRequests[unitId];
    if (!qualifyingSupport(entry, reported, scenario) || entry === undefined) {
      delete promises[unitId];
      if (request !== undefined) {
        state.player.supportRequests[unitId] = { ...request, answer: { kind: 'cancelled', aircraftId: promise.aircraftId, answeredAt: state.tick } };
      }
      transmit(state, scenario, { kind: 'message', recipient: unitId, message: acknowledgement(state, scenario, null, true) });
    } else if (entry.status === 'onStation') {
      delete promises[unitId];
    } else {
      const revised = supportFor(entry, state.tick, scenario);
      if (Math.abs(revised.etaAt - promise.etaAt) >= scenario.file.air.supportEtaSlipSeconds) {
        promises[unitId] = revised;
        if (request?.answer?.kind === 'inbound') {
          state.player.supportRequests[unitId] = { ...request, answer: { ...request.answer, etaAt: revised.etaAt } };
        }
        transmit(state, scenario, { kind: 'message', recipient: unitId, message: acknowledgement(state, scenario, revised, false) });
      }
    }
  }
}
