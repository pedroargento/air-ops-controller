import type { ContactEstimate } from '../domain/public/estimates';
import { distance } from '../domain/public/geometry';
import { holdsGround, type DrillKind, type UnitKnowledge, type UnitSelf } from '../domain/public/ground';
import type {
  MessageId,
  ObjectiveStatus,
  RadioMemory,
  RadioMessage,
  ReportKind,
  ReportNeed,
} from '../domain/public/radio';
import { groupedContact, groupLeads, groupStrength } from './contact-groups';
import type { RadioConfig } from '../scenario/schema';
import type { FireStatus } from '../domain/public/fire';

/**
 * What the unit can say about its own fight (§7.3): whether it is under fire and how hard,
 * where the fire comes from, and what it is firing at. Nothing when it is in no fight.
 */
export function fireStatus(knowledge: UnitKnowledge): FireStatus | null {
  const { fire } = knowledge;
  const engaging = Object.keys(fire.engaging)
    .sort()
    .flatMap((id) => {
      const contact = knowledge.contacts[id];
      return contact === undefined ? [] : [contact];
    });
  if (fire.since === null && engaging.length === 0) return null;
  const from = Object.keys(fire.from)
    .sort()
    .map((key) => fire.from[key] as FireStatus['from'][number]);
  const heavy = fire.since !== null && fire.heavyAt !== null && fire.heavyAt >= fire.since;
  return { underFire: fire.since !== null, intensity: heavy ? 'heavy' : 'light', since: fire.since, from, engaging };
}

const MOVING_DRILLS: ReadonlySet<DrillKind> = new Set(['bypass', 'pushThrough', 'attack', 'farAmbush']);

export const REPORT_PRIORITY: Readonly<Record<ReportKind, number>> = {
  TIC: 0,
  CHECK_FIRE: 0,
  SUPPORT_REQUEST: 1,
  // Ahead of contact reports: a unit in a heavy fight always has another contact to
  // report, and its own casualties would otherwise never get through.
  SITREP: 2,
  DRILL: 2,
  CONTACT_REPORT: 3,
  POSITION_REPORT: 4,
};

export function initialRadioMemory(personnel: number): RadioMemory {
  return {
    lastPositionAt: null,
    lastTicAt: null,
    lastSupportRequestAt: null,
    lastDangerCloseAt: null,
    lastSitrepPersonnel: personnel,
    lastSitrepAt: null,
    reportedContacts: {},
    supportAcknowledgedAt: null,
  };
}

/** The hostile within reach that the unit believes is strongest, breaking ties by contact ID. */
function strongestHostile(self: UnitSelf, knowledge: UnitKnowledge, within: number): ContactEstimate | null {
  let best: ContactEstimate | null = null;
  let bestStrength = 0;
  for (const id of Object.keys(knowledge.contacts).sort()) {
    const contact = knowledge.contacts[id];
    if (contact === undefined || contact.identification !== 'hostile') continue;
    if (distance(self.position, contact.position.center) > within) continue;
    const strength = groupStrength(knowledge, contact, self.doctrine.groupRadiusMeters);
    if (best === null || strength > bestStrength) {
      best = contact;
      bestStrength = strength;
    }
  }
  return best;
}

function enemyInside(self: UnitSelf, knowledge: UnitKnowledge, meters: number): boolean {
  return Object.values(knowledge.contacts).some(
    (contact) => contact.identification === 'hostile' && distance(self.position, contact.position.center) <= meters,
  );
}

function hostileOnObjective(self: UnitSelf, threat: ContactEstimate): boolean {
  const { objective } = self;
  return (
    holdsGround(objective) &&
    distance(threat.position.center, objective.area.center) <= objective.area.radius + self.doctrine.standoffMeters
  );
}

/** Whether a fight is serious enough to report as a TIC, from the unit's own beliefs (§6.2.1). */
function declaresTic(self: UnitSelf, knowledge: UnitKnowledge, threat: ContactEstimate, config: RadioConfig): boolean {
  if (!self.underFire) return false;
  const lost = 1 - self.personnel / self.initialPersonnel;
  return (
    groupStrength(knowledge, threat, self.doctrine.groupRadiusMeters) / self.personnel >= config.ticStrengthRatio ||
    lost >= config.ticCasualtyFraction ||
    self.suppression >= self.doctrine.pinnedSuppression ||
    hostileOnObjective(self, threat)
  );
}

/** Whether the unit judges that it can't deal with the fight on its own. */
function needsSupport(self: UnitSelf, knowledge: UnitKnowledge, threat: ContactEstimate, config: RadioConfig): boolean {
  const lost = 1 - self.personnel / self.initialPersonnel;
  return (
    groupStrength(knowledge, threat, self.doctrine.groupRadiusMeters) / self.personnel >= config.supportStrengthRatio ||
    lost >= config.supportCasualtyFraction ||
    self.ammunition <= self.initialAmmunition * config.supportAmmunitionFraction ||
    hostileOnObjective(self, threat)
  );
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
  // A unit under radio discipline speaks only when asked: a downed aircrew saving battery (§8.8).
  if (self.doctrine.radioSilent) return { needs, memory };

  const threat = strongestHostile(self, knowledge, config.ticRangeMeters);
  const inContact = threat !== null && declaresTic(self, knowledge, threat, config);
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
  // Enemy this close changes the request, so it can go out again even if the last one was answered.
  const close = inContact && canRequestSupport && enemyInside(self, knowledge, config.dangerCloseMeters);
  const closeDue = close && (next.lastDangerCloseAt === null || tick - next.lastDangerCloseAt >= config.supportRequestCooldownSeconds);
  // Guns keep heads down while a platoon moves; close in, they're also all that's safe.
  const moving = self.drill !== null && MOVING_DRILLS.has(self.drill.kind);
  if (closeDue) {
    needs.push({ kind: 'SUPPORT_REQUEST', contactId: null, dangerClose: true, wants: 'guns', ...nineLine(self, threat, config) });
    next = { ...next, lastSupportRequestAt: tick, lastDangerCloseAt: tick };
  } else if (inContact && needsSupport(self, knowledge, threat, config) && canRequestSupport && requestDue && !acknowledged) {
    needs.push({ kind: 'SUPPORT_REQUEST', contactId: null, wants: moving ? 'guns' : 'both', ...nineLine(self, threat, config) });
    next = { ...next, lastSupportRequestAt: tick };
  } else if (self.drill?.kind === 'waitForAir' && canRequestSupport && requestDue && !acknowledged) {
    // Holding short of a position for air: guns on it, so the platoon can pass.
    needs.push({ kind: 'SUPPORT_REQUEST', contactId: null, wants: 'guns', target: self.drill.target });
    next = { ...next, lastSupportRequestAt: tick };
  }

  for (const contact of groupLeads(knowledge, self.doctrine.groupRadiusMeters)) {
    const id = contact.contactId;
    const reportedAt = next.reportedContacts[id];
    if (reportedAt !== undefined && tick - reportedAt < config.contactReportIntervalSeconds) continue;
    needs.push({ kind: 'CONTACT_REPORT', contactId: id, captured: groupedContact(knowledge, contact, self.doctrine.groupRadiusMeters) });
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
  return holdsGround(self.objective) ? 'holding' : 'advancing';
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
  const known = need.contactId === null ? newestContact(need, knowledge) : (knowledge.contacts[need.contactId] ?? null);
  const contact = known === null ? (need.captured ?? null) : groupedContact(knowledge, known, self.doctrine.groupRadiusMeters);
  const meta = { id, senderId: self.id, sentAt, receivedAt };
  const ownPosition = self.ownPosition;
  const status = fireStatus(knowledge);
  const fire = status === null ? {} : { fire: status };

  switch (need.kind) {
    case 'TIC':
      return {
        ...meta,
        kind: 'TIC',
        observedAt: contact?.position.observedAt ?? ownPosition.observedAt,
        ownPosition,
        contact,
        ...fire,
      };
    case 'CONTACT_REPORT':
      if (contact !== null) {
        return { ...meta, kind: 'CONTACT_REPORT', observedAt: contact.position.observedAt, contact };
      }
      // Asked for a contact update with nothing to report: the unit says where it is instead.
      return need.contactId === null
        ? { ...meta, kind: 'POSITION_REPORT', observedAt: ownPosition.observedAt, position: ownPosition, ...fire }
        : null;
    case 'POSITION_REPORT':
      return { ...meta, kind: 'POSITION_REPORT', observedAt: ownPosition.observedAt, position: ownPosition, ...fire };
    case 'SITREP':
      return {
        ...meta,
        kind: 'SITREP',
        observedAt: ownPosition.observedAt,
        ownPosition,
        personnel: self.personnel,
        ammunitionFraction: self.ammunition / self.initialAmmunition,
        status: objectiveStatus(self),
        ...fire,
      };
    case 'SUPPORT_REQUEST':
      return {
        ...meta,
        kind: 'SUPPORT_REQUEST',
        observedAt: ownPosition.observedAt,
        ownPosition,
        dangerClose: need.dangerClose === true,
        wants: need.wants ?? 'both',
        target: need.target ?? null,
        targetStrength: need.targetStrength ?? null,
        marked: need.marked === true,
        ...fire,
      };
    case 'CHECK_FIRE':
      return { ...meta, kind: 'CHECK_FIRE', observedAt: ownPosition.observedAt, ownPosition };
    case 'DRILL':
      return need.drill === undefined
        ? null
        : { ...meta, kind: 'DRILL', observedAt: ownPosition.observedAt, ownPosition, drill: need.drill };
  }
}

/**
 * What a 9-line request carries, as far as a platoon knows it: where the enemy firing on it
 * is, how big, and whether it will mark it with smoke, which it can only do within reach.
 */
function nineLine(self: UnitSelf, threat: ContactEstimate, config: RadioConfig): Pick<ReportNeed, 'target' | 'targetStrength' | 'marked'> {
  const target = threat.position.center;
  return { target, targetStrength: threat.strength, marked: distance(self.position, target) <= config.markRangeMeters };
}
