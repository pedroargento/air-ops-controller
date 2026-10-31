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
} from '../domain/public/radio';
import type { Aircraft } from '../domain/truth/world';
import { receiveByUnit } from '../knowledge/unit-knowledge';
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
  if (request !== undefined) state.player.supportRequests[unitId] = { ...request, acknowledged: true };
  transmit(state, scenario, { kind: 'message', recipient: unitId, message: acknowledgement(state, scenario, support, false) });
}

function forwardContact(state: SimState, scenario: Scenario, contactKey: string, recipients: readonly string[]): void {
  const entry = state.player.contacts[contactKey];
  if (entry === undefined) return;
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
      if (aircraft !== undefined) applyOrder(aircraft, command.order, scenario.file.air);
      return;
    }
    case 'setAltitude': {
      const aircraft = aircraftById(state.truth.aircraft, command.aircraftId);
      if (aircraft !== undefined) setTargetAltitude(aircraft, command.meters, scenario.file.air);
      return;
    }
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
    if (!qualifyingSupport(entry, reported, scenario) || entry === undefined) {
      delete promises[unitId];
      transmit(state, scenario, { kind: 'message', recipient: unitId, message: acknowledgement(state, scenario, null, true) });
    } else if (entry.status === 'onStation') {
      delete promises[unitId];
    } else {
      const revised = supportFor(entry, state.tick, scenario);
      if (Math.abs(revised.etaAt - promise.etaAt) >= scenario.file.air.supportEtaSlipSeconds) {
        promises[unitId] = revised;
        transmit(state, scenario, { kind: 'message', recipient: unitId, message: acknowledgement(state, scenario, revised, false) });
      }
    }
  }
}
