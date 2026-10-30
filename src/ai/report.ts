import type { ContactEstimate } from '../domain/public/estimates';
import { distance } from '../domain/public/geometry';
import type { ContactId, UnitKnowledge, UnitSelf } from '../domain/public/ground';
import type {
  MessageId,
  ObjectiveStatus,
  RadioMemory,
  RadioMessage,
  ReportKind,
  ReportNeed,
} from '../domain/public/radio';
import type { RadioConfig } from '../scenario/schema';

export const REPORT_PRIORITY: Readonly<Record<ReportKind, number>> = {
  TIC: 0,
  SUPPORT_REQUEST: 1,
  CONTACT_REPORT: 2,
  SITREP: 3,
  POSITION_REPORT: 4,
};

export function initialRadioMemory(personnel: number): RadioMemory {
  return {
    lastPositionAt: null,
    lastTicAt: null,
    lastSupportRequestAt: null,
    lastSitrepPersonnel: personnel,
    lastSitrepAt: null,
    reportedContacts: {},
    supportAcknowledgedAt: null,
  };
}

function nearestHostile(self: UnitSelf, knowledge: UnitKnowledge, within: number): ContactEstimate | null {
  let best: ContactEstimate | null = null;
  let bestRange = within;
  for (const id of Object.keys(knowledge.contacts).sort()) {
    const contact = knowledge.contacts[id];
    if (contact === undefined || contact.identification !== 'hostile') continue;
    const range = distance(self.position, contact.position.center);
    if (range <= bestRange) {
      best = contact;
      bestRange = range;
    }
  }
  return best;
}

export type ReportDecision = Readonly<{ needs: readonly ReportNeed[]; memory: RadioMemory }>;

/**
 * Decides what the unit wants to report, from its beliefs alone. `canRequestSupport`
 * is true when the unit is linked to air operations; the rule is the same for every unit.
 */
export function decideReports(
  self: UnitSelf,
  knowledge: UnitKnowledge,
  memory: RadioMemory,
  config: RadioConfig,
  canRequestSupport: boolean,
  tick: number,
): ReportDecision {
  const needs: ReportNeed[] = [];
  let next = memory;

  const threat = nearestHostile(self, knowledge, config.ticRangeMeters);
  const inContact = threat !== null && (self.underFire || self.ammunition < self.initialAmmunition);
  const ticDue = next.lastTicAt === null || tick - next.lastTicAt >= config.ticCooldownSeconds;
  if (inContact && ticDue) {
    needs.push({ kind: 'TIC', contactId: threat.contactId });
    next = { ...next, lastTicAt: tick };
  }

  const requestDue =
    next.lastSupportRequestAt === null ||
    tick - next.lastSupportRequestAt >= config.supportRequestCooldownSeconds;
  const acknowledged =
    next.supportAcknowledgedAt !== null &&
    tick - next.supportAcknowledgedAt < config.supportRequestCooldownSeconds;
  if (inContact && canRequestSupport && requestDue && !acknowledged) {
    needs.push({ kind: 'SUPPORT_REQUEST', contactId: null });
    next = { ...next, lastSupportRequestAt: tick };
  }

  for (const id of Object.keys(knowledge.contacts).sort()) {
    const contact = knowledge.contacts[id];
    if (contact === undefined) continue;
    const reportedAt = next.reportedContacts[id];
    if (reportedAt !== undefined && tick - reportedAt < config.contactReportIntervalSeconds) continue;
    needs.push({ kind: 'CONTACT_REPORT', contactId: id as ContactId, captured: contact });
    next = { ...next, reportedContacts: { ...next.reportedContacts, [id]: tick } };
  }

  const lostFraction = (next.lastSitrepPersonnel - self.personnel) / self.initialPersonnel;
  const sitrepDue =
    next.lastSitrepAt === null || tick - next.lastSitrepAt >= config.sitrepIntervalSeconds;
  if (lostFraction >= config.sitrepCasualtyStep || (inContact && sitrepDue)) {
    needs.push({ kind: 'SITREP', contactId: null });
    next = { ...next, lastSitrepPersonnel: self.personnel, lastSitrepAt: tick };
  }

  const positionDue =
    next.lastPositionAt === null || tick - next.lastPositionAt >= config.positionIntervalSeconds;
  if (positionDue) {
    needs.push({ kind: 'POSITION_REPORT', contactId: null });
    next = { ...next, lastPositionAt: tick };
  }

  return { needs, memory: next };
}

function newestContact(need: ReportNeed, knowledge: UnitKnowledge): ContactEstimate | null {
  if (need.kind !== 'CONTACT_REPORT') return null;
  let newest: ContactEstimate | null = null;
  for (const id of Object.keys(knowledge.contacts).sort()) {
    const contact = knowledge.contacts[id];
    if (contact !== undefined && (newest === null || contact.position.observedAt > newest.position.observedAt)) {
      newest = contact;
    }
  }
  return newest;
}

function objectiveStatus(self: UnitSelf): ObjectiveStatus {
  if (self.mode === 'broken') return 'combat-ineffective';
  if (self.mode === 'withdrawing' || self.mode === 'recovering') return 'withdrawing';
  return self.objective.kind === 'HoldArea' ? 'holding' : 'advancing';
}

/**
 * Writes a report from the unit's current beliefs at the moment transmission starts,
 * so it carries any newer observation. Returns null if there is nothing left to say.
 */
export function composeReport(
  need: ReportNeed,
  self: UnitSelf,
  knowledge: UnitKnowledge,
  id: MessageId,
  sentAt: number,
  receivedAt: number,
): RadioMessage | null {
  const contact =
    need.contactId === null
      ? newestContact(need, knowledge)
      : (knowledge.contacts[need.contactId] ?? need.captured ?? null);
  const meta = { id, senderId: self.id, sentAt, receivedAt };
  const ownPosition = self.ownPosition;

  switch (need.kind) {
    case 'TIC':
      return {
        ...meta,
        kind: 'TIC',
        observedAt: contact?.position.observedAt ?? ownPosition.observedAt,
        ownPosition,
        contact,
      };
    case 'CONTACT_REPORT':
      if (contact !== null) {
        return { ...meta, kind: 'CONTACT_REPORT', observedAt: contact.position.observedAt, contact };
      }
      // Asked for a contact update with nothing to report: the unit says where it is instead.
      return need.contactId === null
        ? { ...meta, kind: 'POSITION_REPORT', observedAt: ownPosition.observedAt, position: ownPosition }
        : null;
    case 'POSITION_REPORT':
      return { ...meta, kind: 'POSITION_REPORT', observedAt: ownPosition.observedAt, position: ownPosition };
    case 'SITREP':
      return {
        ...meta,
        kind: 'SITREP',
        observedAt: ownPosition.observedAt,
        ownPosition,
        personnel: self.personnel,
        ammunitionFraction: self.ammunition / self.initialAmmunition,
        status: objectiveStatus(self),
      };
    case 'SUPPORT_REQUEST':
      return { ...meta, kind: 'SUPPORT_REQUEST', observedAt: ownPosition.observedAt, ownPosition };
  }
}
