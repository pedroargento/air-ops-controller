import { composeReport, decideReports, initialRadioMemory, REPORT_PRIORITY } from '../ai/report';
import type { ReportRequest } from '../domain/public/commands';
import type { UnitKnowledge, UnitSelf } from '../domain/public/ground';
import {
  AIR_OPS,
  CECON,
  type ExpectedSupport,
  type MessageId,
  type RadioMemory,
  type RadioMessage,
  type RadioTask,
  type ReportNeed,
} from '../domain/public/radio';
import type { GroundIntent, GroundMode } from '../domain/public/ground';
import type { Platoon } from '../domain/truth/world';
import { emptyKnowledge } from '../domain/public/ground';
import { receiveByPlayer, type PlayerKnowledge } from '../knowledge/player-knowledge';
import { receiveByUnit } from '../knowledge/unit-knowledge';
import type { Scenario } from '../scenario/load';
import { hasGroundLos } from '../domain/public/terrain';
import type { RadioConfig } from '../scenario/schema';

export type UnitRadio = {
  memory: RadioMemory;
  queue: RadioTask[];
};

export type PendingTransmission = {
  /** When it arrives, where transmissions go out side by side (`netSerial` off). */
  deliverAt: number;
  payload:
    | Readonly<{ kind: 'message'; recipient: string; message: RadioMessage }>
    | Readonly<{ kind: 'request'; unitId: string; report: ReportRequest }>;
  /**
   * Set on a call to all stations: every transmission with the same value goes out as one, and
   * nobody reads it back. Null for a call to one unit.
   */
  broadcast: string | null;
  /** What it is about, when a later word on the same thing makes this one out of date. */
  topic: string | null;
  /** Lower goes first: an answer a unit is waiting for goes ahead of intelligence passed on. */
  priority: number;
  queuedAt: number;
  /** When air operations began sending it, or null while it waits its turn (§6.5). */
  startedAt: number | null;
  /** Seconds of it the unit has copied so far, at the unit's own radio rate. */
  progressSeconds: number;
};

/** Who an outbound transmission is for. */
export function recipientOf(transmission: PendingTransmission): string {
  return transmission.payload.kind === 'message' ? transmission.payload.recipient : transmission.payload.unitId;
}

/** What air operations is sending right now, on a net that sends one thing at a time: one call, or one call to all stations. */
export function onAir(radio: RadioState, config: RadioConfig): readonly PendingTransmission[] {
  const head = radio.outbound[0];
  if (!config.netSerial || head === undefined || head.startedAt === null) return [];
  return head.broadcast === null ? [head] : radio.outbound.filter((entry) => entry.broadcast === head.broadcast);
}

export type RadioState = {
  units: Record<string, UnitRadio>;
  nextMessageNumber: number;
  outbound: PendingTransmission[];
  /** The net is left clear until this tick after a transmission, so that waiting units get through. */
  netFreeAt: number;
  // Support promised to each unit, so a changed assignment can be corrected.
  promises: Record<string, ExpectedSupport>;
};

/** A platoon's radio works at the pace of its lead squad (§4.0.1). */
export type RadioUnit = Readonly<{
  id: string;
  personnel: number;
  mode: GroundMode;
  suppression: number;
  intent: GroundIntent;
}>;

export function createRadioState(units: readonly Pick<Platoon, 'id' | 'initialPersonnel'>[]): RadioState {
  const state: RadioState = { units: {}, nextMessageNumber: 0, outbound: [], netFreeAt: 0, promises: {} };
  for (const unit of units) {
    state.units[unit.id] = { memory: initialRadioMemory(unit.initialPersonnel), queue: [] };
  }
  return state;
}

export function linkedNodes(scenario: Scenario, id: string): readonly string[] {
  const nodes = scenario.file.links.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));
  return [...new Set(nodes)].sort();
}

function sameNeed(a: ReportNeed, b: ReportNeed): boolean {
  return a.kind === b.kind && a.contactId === b.contactId && a.drill === b.drill;
}

export function enqueue(
  radio: UnitRadio,
  need: ReportNeed,
  tick: number,
  priority: number = REPORT_PRIORITY[need.kind],
): void {
  if (radio.queue.some((task) => sameNeed(task.need, need))) return;
  radio.queue.push({
    need,
    priority,
    createdAt: tick,
    phase: 'queued',
    progressSeconds: 0,
    sentAt: null,
    message: null,
  });
  // The task already on the air, if any, is never displaced.
  const active = radio.queue.findIndex((task) => task.phase === 'transmitting');
  const head = active >= 0 ? radio.queue.splice(active, 1) : [];
  radio.queue.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  radio.queue.unshift(...head);
}

/** Lets each unit decide what it wants to report, using only its own beliefs. */
export function planReports(
  units: readonly RadioUnit[],
  selves: ReadonlyMap<string, UnitSelf>,
  knowledge: Record<string, UnitKnowledge>,
  radio: RadioState,
  scenario: Scenario,
  tick: number,
): void {
  for (const unit of units) {
    const self = selves.get(unit.id);
    const unitRadio = radio.units[unit.id];
    if (self === undefined || unitRadio === undefined || unit.personnel <= 0) continue;
    const canRequestSupport = linkedNodes(scenario, unit.id).includes(AIR_OPS);
    const { needs, memory } = decideReports(
      self,
      knowledge[unit.id] ?? emptyKnowledge(),
      unitRadio.memory,
      scenario.file.radio,
      canRequestSupport,
      tick,
      (from, to) => hasGroundLos(scenario.terrain, from, to),
    );
    unitRadio.memory = memory;
    for (const need of needs) enqueue(unitRadio, need, tick);
  }
}

/** Seconds of radio work completed this tick. Fighting slows it; heavy fire stops it. */
export function radioRate(unit: RadioUnit, config: RadioConfig): number {
  if (unit.suppression >= config.interruptSuppression) return 0;
  if (unit.mode === 'withdrawing') return config.withdrawingRate;
  return unit.intent.kind === 'engage' ? config.engagedRate : 1;
}

export type Delivery = Readonly<{ message: RadioMessage; recipients: readonly string[] }>;

function advanceUnit(
  unit: RadioUnit,
  selfOf: () => UnitSelf | undefined,
  unitRadio: UnitRadio,
  knowledge: UnitKnowledge,
  radio: RadioState,
  scenario: Scenario,
  tick: number,
  /** Air operations is sending, so it hears nobody until it stops. */
  netBusy: boolean,
): Delivery | null {
  const task = unitRadio.queue[0];
  if (task === undefined) return null;
  const config = scenario.file.radio;
  const rate = radioRate(unit, config);

  if (rate === 0) {
    // A broken transmission is not lost: it restarts once the unit can talk again.
    if (task.phase === 'transmitting') {
      task.phase = 'interrupted';
      task.progressSeconds = 0;
      task.message = null;
      task.sentAt = null;
    }
    return null;
  }

  if (task.phase === 'queued') task.phase = 'preparing';
  if (task.phase === 'preparing') {
    task.progressSeconds += rate;
    if (task.progressSeconds < config.prepareSeconds) return null;
    task.phase = 'interrupted';
    task.progressSeconds = 0;
  }

  if (task.phase === 'interrupted') {
    radio.nextMessageNumber += 1;
    const id = `M-${radio.nextMessageNumber}` as MessageId;
    const self = selfOf();
    const message = self === undefined ? null : composeReport(task.need, self, knowledge, id, tick, tick);
    if (message === null) {
      unitRadio.queue.shift();
      return null;
    }
    task.phase = 'transmitting';
    task.sentAt = tick;
    task.message = message;
  }

  task.progressSeconds += rate;
  if (task.progressSeconds < config.transmitSeconds || task.message === null) return null;
  const recipients = linkedNodes(scenario, unit.id);
  // The unit keeps calling until air operations stops talking, and sends nothing else meanwhile.
  if (netBusy && recipients.includes(AIR_OPS)) return null;
  unitRadio.queue.shift();
  return {
    message: { ...task.message, receivedAt: tick },
    recipients,
  };
}

export function deliver(
  delivery: Delivery,
  knowledge: Record<string, UnitKnowledge>,
  player: PlayerKnowledge,
  comparableSeconds: number,
): void {
  for (const recipient of delivery.recipients) {
    if (recipient === AIR_OPS) {
      receiveByPlayer(player, delivery.message, comparableSeconds);
    } else {
      receiveByUnit((knowledge[recipient] ??= emptyKnowledge()), delivery.message);
    }
  }
}

export function advanceRadio(
  units: readonly RadioUnit[],
  selves: Pick<ReadonlyMap<string, UnitSelf>, 'get'>,
  knowledge: Record<string, UnitKnowledge>,
  radio: RadioState,
  player: PlayerKnowledge,
  scenario: Scenario,
  tick: number,
  /** Sees every finished transmission, and can change it or stop it (a flat battery). */
  onTransmitted: (unitId: string, message: RadioMessage) => RadioMessage | null = (_, message) => message,
): void {
  const deliveries: Delivery[] = [];
  const sending = onAir(radio, scenario.file.radio);
  const copying = new Set(sending.map(recipientOf));
  for (const unit of units) {
    const unitRadio = radio.units[unit.id];
    if (unitRadio === undefined) continue;
    if (unit.personnel <= 0) {
      unitRadio.queue = [];
      continue;
    }
    // A unit copying a message from air operations does no radio work of its own (§6.5).
    if (copying.has(unit.id)) continue;
    const delivery = advanceUnit(
      unit,
      () => selves.get(unit.id),
      unitRadio,
      knowledge[unit.id] ?? emptyKnowledge(),
      radio,
      scenario,
      tick,
      sending.length > 0,
    );
    if (delivery !== null) {
      const message = onTransmitted(unit.id, delivery.message);
      if (message !== null) deliveries.push({ ...delivery, message });
    }
  }
  const comparable = scenario.file.display.freshReportSeconds;
  for (const delivery of deliveries) deliver(delivery, knowledge, player, comparable);

  for (const update of scenario.file.ceconMessages) {
    if (update.atSeconds !== tick) continue;
    radio.nextMessageNumber += 1;
    receiveByPlayer(
      player,
      {
        id: `M-${radio.nextMessageNumber}` as MessageId,
        kind: 'COMMAND_UPDATE',
        senderId: CECON,
        observedAt: tick,
        sentAt: tick,
        receivedAt: tick,
        text: update.text,
      },
      comparable,
    );
  }
}
