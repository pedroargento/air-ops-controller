import { describe, expect, it } from 'vitest';
import { composeReport, decideReports, initialRadioMemory } from '../../src/ai/report';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import { emptyKnowledge, type ContactId, type UnitKnowledge, type UnitSelf } from '../../src/domain/public/ground';
import { AIR_OPS, CECON, type MessageId, type ReportNeed } from '../../src/domain/public/radio';
import type { GroundUnit } from '../../src/domain/truth/world';
import { emptyPlayerKnowledge } from '../../src/knowledge/player-knowledge';
import { loadScenario } from '../../src/scenario/load';
import { advanceRadio, createRadioState, enqueue, linkedNodes, radioRate } from '../../src/sim/radio';
import { createInitialState } from '../../src/sim/state';
import { readFileSync } from 'node:fs';

const scenario = loadScenarioFile();
const { radio: config } = scenario.file;
const TOTAL_SECONDS = config.prepareSeconds + config.transmitSeconds;

const contact: ContactEstimate = {
  contactId: 'C-1' as ContactId,
  provenance: { sourceId: 'F-A', observedAt: 10 },
  identification: 'hostile',
  position: { center: { x: 500, y: 100 }, sigmaMeters: 40, headingRad: null, speedMps: null, observedAt: 10 },
  strength: { kind: 'range', min: 15, max: 50 },
  kind: 'infantry',
  activity: 'moving',
  confidence: 'medium',
  observedWeapons: [],
};

function setup() {
  const state = createInitialState(scenario, 1);
  const unit = state.truth.units.find((u) => u.id === 'F-A') as GroundUnit;
  const self: UnitSelf = {
    id: unit.id,
    side: unit.side,
    position: unit.position,
    ownPosition: { center: { x: 512, y: 488 }, sigmaMeters: 40, headingRad: null, speedMps: null, observedAt: 0 },
    personnel: unit.personnel,
    initialPersonnel: unit.initialPersonnel,
    ammunition: unit.initialAmmunition,
    initialAmmunition: unit.initialAmmunition,
    equipment: unit.equipment,
    supportWeapons: 1,
    airWeapons: [],
    morale: unit.morale,
    suppression: 0,
    underFire: false,
    mode: 'steady',
    behavior: null,
    behaviorSinceTick: 0,
    groundCover: 0,
    returnsUsed: 0,
    patrolIndex: 0,
    objective: unit.objective,
    fallback: unit.fallback,
    doctrine: unit.doctrine,
  };
  const knowledge: Record<string, UnitKnowledge> = { [unit.id]: emptyKnowledge() };
  const radio = createRadioState(state.truth.units);
  const player = emptyPlayerKnowledge();
  const selves = new Map([[unit.id as string, self]]);
  const unitRadio = radio.units[unit.id];
  if (unitRadio === undefined) throw new Error('missing radio');
  return { unit, self, knowledge, radio, player, selves, unitRadio };
}

const need: ReportNeed = { kind: 'POSITION_REPORT', contactId: null };
const faraway: UnitSelf['objective'] = { kind: 'MoveTo', area: { center: { x: 0, y: 0 }, radius: 10 } };

function runSeconds(s: ReturnType<typeof setup>, seconds: number, from = 0): void {
  for (let tick = from; tick < from + seconds; tick += 1) {
    advanceRadio([s.unit], s.selves, s.knowledge, s.radio, s.player, scenario, tick);
  }
}

const reports = (s: ReturnType<typeof setup>) => s.player.log.filter((m) => m.senderId !== CECON);

describe('radio tasks', () => {
  it('takes simulated time before a report arrives, with distinct send and receive times', () => {
    const s = setup();
    enqueue(s.unitRadio, need, 0);
    runSeconds(s, TOTAL_SECONDS - 2);
    expect(reports(s)).toHaveLength(0);
    runSeconds(s, 3, TOTAL_SECONDS - 2);
    expect(reports(s)).toHaveLength(1);
    const message = reports(s)[0];
    expect(message?.receivedAt).toBeGreaterThan(message?.sentAt ?? Infinity);
  });

  it('runs at full speed when idle, modestly slower when engaging, and stops under heavy suppression', () => {
    const { unit } = setup();
    expect(radioRate(unit, config)).toBe(1);
    unit.intent = { kind: 'engage', contactId: 'C-1' as ContactId, closeTo: null, fireRate: 1, prepared: false };
    expect(radioRate(unit, config)).toBe(config.engagedRate);
    expect(config.engagedRate).toBeGreaterThan(0.5);
    unit.suppression = config.interruptSuppression;
    expect(radioRate(unit, config)).toBe(0);
  });

  it('keeps an interrupted transmission and retries it', () => {
    const s = setup();
    enqueue(s.unitRadio, need, 0);
    runSeconds(s, config.prepareSeconds + 2);
    expect(s.unitRadio.queue[0]?.phase).toBe('transmitting');

    s.unit.suppression = 0.95;
    runSeconds(s, 30, 100);
    expect(reports(s)).toHaveLength(0);
    expect(s.unitRadio.queue[0]?.phase).toBe('interrupted');

    s.unit.suppression = 0;
    runSeconds(s, config.transmitSeconds + 1, 200);
    expect(reports(s)).toHaveLength(1);
  });

  it('sends urgent reports first without cutting off one already on the air', () => {
    const s = setup();
    enqueue(s.unitRadio, need, 0);
    runSeconds(s, config.prepareSeconds + 2);
    enqueue(s.unitRadio, { kind: 'TIC', contactId: null }, 20);
    enqueue(s.unitRadio, { kind: 'SITREP', contactId: null }, 20);
    expect(s.unitRadio.queue.map((t) => t.need.kind)).toEqual(['POSITION_REPORT', 'TIC', 'SITREP']);
  });

  it('does not queue the same report twice', () => {
    const s = setup();
    enqueue(s.unitRadio, need, 0);
    enqueue(s.unitRadio, need, 5);
    expect(s.unitRadio.queue).toHaveLength(1);
  });

  it('drops the queue when the unit is destroyed', () => {
    const s = setup();
    enqueue(s.unitRadio, need, 0);
    s.unit.personnel = 0;
    runSeconds(s, TOTAL_SECONDS + 5);
    expect(reports(s)).toHaveLength(0);
  });
});

describe('deciding what to report', () => {
  const decide = (self: UnitSelf, knowledge: UnitKnowledge, memory = initialRadioMemory(40), tick = 100) =>
    decideReports(self, knowledge, memory, config, true, tick);
  const inContact = { ...emptyKnowledge(), contacts: { 'C-1': { ...contact, position: { ...contact.position, center: { x: 2525, y: 2500 } } } } };

  it('raises a TIC and support request only when actually in contact', () => {
    const { self } = setup();
    expect(decide(self, emptyKnowledge()).needs.map((n) => n.kind)).not.toContain('TIC');
    const kinds = decide({ ...self, underFire: true }, inContact).needs.map((n) => n.kind);
    expect(kinds).toEqual(expect.arrayContaining(['TIC', 'SUPPORT_REQUEST', 'CONTACT_REPORT']));
  });

  it('does not declare a TIC for an unthreatening contact, even after firing', () => {
    const { self } = setup();
    const weak = { ...contact, strength: { kind: 'range' as const, min: 2, max: 6 } };
    const near = { ...emptyKnowledge(), contacts: { 'C-1': { ...weak, position: { ...weak.position, center: self.position } } } };
    const fired = { ...self, ammunition: self.initialAmmunition - 100, objective: faraway };
    expect(decide(fired, near).needs.map((n) => n.kind)).not.toContain('TIC');
    expect(decide({ ...fired, underFire: true }, near).needs.map((n) => n.kind)).not.toContain('TIC');
  });

  it('can declare a TIC without asking for air support', () => {
    const { self } = setup();
    const even = { ...contact, strength: { kind: 'range' as const, min: 45, max: 55 } };
    const near = { ...emptyKnowledge(), contacts: { 'C-1': { ...even, position: { ...even.position, center: self.position } } } };
    const needs = decide({ ...self, underFire: true, objective: faraway }, near).needs.map((n) => n.kind);
    expect(needs).toContain('TIC');
    expect(needs).not.toContain('SUPPORT_REQUEST');
  });

  it('asks for air support when it judges its own resources insufficient', () => {
    const { self } = setup();
    const even = { ...contact, strength: { kind: 'range' as const, min: 45, max: 55 } };
    const near = { ...emptyKnowledge(), contacts: { 'C-1': { ...even, position: { ...even.position, center: self.position } } } };
    const low = { ...self, underFire: true, objective: faraway, ammunition: self.initialAmmunition * 0.1 };
    expect(decide(low, near).needs.map((n) => n.kind)).toContain('SUPPORT_REQUEST');
    const bloodied = { ...self, underFire: true, objective: faraway, personnel: 30 };
    expect(decide(bloodied, near).needs.map((n) => n.kind)).toContain('SUPPORT_REQUEST');
  });

  it('treats an enemy on its position as a threat whatever its size', () => {
    const { self } = setup();
    const weak = { ...contact, strength: { kind: 'range' as const, min: 2, max: 6 } };
    const near = { ...emptyKnowledge(), contacts: { 'C-1': { ...weak, position: { ...weak.position, center: self.position } } } };
    const kinds = decide({ ...self, underFire: true }, near).needs.map((n) => n.kind);
    expect(kinds).toEqual(expect.arrayContaining(['TIC', 'SUPPORT_REQUEST']));
  });

  it('gets a status report through ahead of routine contact reports', () => {
    const s = setup();
    enqueue(s.unitRadio, { kind: 'CONTACT_REPORT', contactId: 'C-1' as ContactId }, 10);
    enqueue(s.unitRadio, { kind: 'SITREP', contactId: null }, 20);
    expect(s.unitRadio.queue.map((t) => t.need.kind)).toEqual(['SITREP', 'CONTACT_REPORT']);
  });

  it('paces repeat TICs', () => {
    const { self } = setup();
    const first = decide({ ...self, underFire: true }, inContact);
    const soon = decide({ ...self, underFire: true }, inContact, first.memory, 110);
    expect(soon.needs.map((n) => n.kind)).not.toContain('TIC');
  });

  it('stops repeating a support request once acknowledged', () => {
    const { self } = setup();
    const memory = { ...initialRadioMemory(40), supportAcknowledgedAt: 95 };
    const kinds = decide({ ...self, underFire: true }, inContact, memory).needs.map((n) => n.kind);
    expect(kinds).not.toContain('SUPPORT_REQUEST');
  });

  it('only a unit linked to air operations asks for support', () => {
    const { self } = setup();
    const { needs } = decideReports({ ...self, underFire: true }, inContact, initialRadioMemory(40), config, false, 100);
    expect(needs.map((n) => n.kind)).not.toContain('SUPPORT_REQUEST');
  });

  it('sends SITREPs periodically while in contact, and after casualties', () => {
    const { self } = setup();
    const engaged = { ...self, underFire: true };
    const first = decide(engaged, inContact);
    expect(first.needs.map((n) => n.kind)).toContain('SITREP');
    const soon = decide(engaged, inContact, first.memory, 150);
    expect(soon.needs.map((n) => n.kind)).not.toContain('SITREP');
    const later = decide(engaged, inContact, first.memory, 100 + config.sitrepIntervalSeconds);
    expect(later.needs.map((n) => n.kind)).toContain('SITREP');
    const hurt = decide({ ...self, personnel: 30 }, emptyKnowledge(), first.memory, 150);
    expect(hurt.needs.map((n) => n.kind)).toContain('SITREP');
  });

  it('schedules position reports', () => {
    const { self } = setup();
    expect(decide(self, emptyKnowledge()).needs.map((n) => n.kind)).toContain('POSITION_REPORT');
  });
});

describe('composing reports', () => {
  const id = 'M-1' as MessageId;

  it('reports the navigation estimate, not the true position', () => {
    const { self } = setup();
    const message = composeReport(need, self, emptyKnowledge(), id, 10, 10);
    expect(message).toMatchObject({ kind: 'POSITION_REPORT', position: { center: { x: 512, y: 488 } } });
    expect(JSON.stringify(message)).not.toContain(String(self.position.x));
  });

  it('carries the estimate, with its original observation time', () => {
    const { self } = setup();
    const knowledge = { ...emptyKnowledge(), contacts: { 'C-1': contact } };
    const message = composeReport({ kind: 'CONTACT_REPORT', contactId: 'C-1' as ContactId }, self, knowledge, id, 50, 50);
    expect(message).toMatchObject({ observedAt: 10, sentAt: 50, contact });
  });

  it('uses a newer observation if one arrived while the report was queued', () => {
    const { self } = setup();
    const newer = { ...contact, position: { ...contact.position, observedAt: 40 } };
    const knowledge = { ...emptyKnowledge(), contacts: { 'C-1': newer } };
    const message = composeReport({ kind: 'CONTACT_REPORT', contactId: 'C-1' as ContactId }, self, knowledge, id, 50, 50);
    expect(message?.observedAt).toBe(40);
  });

  it('still reports a contact captured earlier, even if it has since aged out of memory', () => {
    const { self } = setup();
    const queued: ReportNeed = { kind: 'CONTACT_REPORT', contactId: 'C-1' as ContactId, captured: contact };
    const message = composeReport(queued, self, emptyKnowledge(), id, 500, 500);
    expect(message).toMatchObject({ kind: 'CONTACT_REPORT', observedAt: 10, contact });
  });

  it('prefers the current belief over the captured observation', () => {
    const { self } = setup();
    const newer = { ...contact, position: { ...contact.position, observedAt: 40 } };
    const queued: ReportNeed = { kind: 'CONTACT_REPORT', contactId: 'C-1' as ContactId, captured: contact };
    const knowledge = { ...emptyKnowledge(), contacts: { 'C-1': newer } };
    expect(composeReport(queued, self, knowledge, id, 50, 50)?.observedAt).toBe(40);
  });
});

describe('communication links', () => {
  it('connects enemy formations to each other and never to air operations', () => {
    const enemies = scenario.file.units.filter((u) => u.side === 'enemy');
    expect(enemies.some((u) => linkedNodes(scenario, u.id).length > 0)).toBe(true);
    for (const unit of enemies) expect(linkedNodes(scenario, unit.id)).not.toContain(AIR_OPS);
  });

  it('rejects a scenario that links across sides', () => {
    const raw = JSON.parse(readFileSync('scenarios/outpost-under-pressure.json', 'utf8')) as {
      links: string[][];
      terrain: { classLayer: string; elevationLayer: string };
    };
    const layer = (name: string) => readFileSync(`scenarios/${name}`, 'utf8');
    const load = (links: string[][]) =>
      loadScenario({ ...raw, links }, layer(raw.terrain.classLayer), layer(raw.terrain.elevationLayer));
    expect(() => load([['E-N1', AIR_OPS]])).toThrow(/crosses sides/);
    expect(() => load([['F-A', 'E-N1']])).toThrow(/crosses sides/);
    expect(() => load([['F-A', 'NOBODY']])).toThrow(/unknown node/);
  });
});
