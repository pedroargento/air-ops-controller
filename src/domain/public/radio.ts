import type { WeaponType } from './equipment';
import type { ContactEstimate, PositionEstimate } from './estimates';
import type { ContactId, GroundMode } from './ground';

export const AIR_OPS = 'AIR_OPS';
export const CECON = 'CECON';

export type MessageId = string & { readonly __brand: 'MessageId' };

type MessageMeta = Readonly<{
  id: MessageId;
  senderId: string;
  observedAt: number;
  sentAt: number;
  receivedAt: number;
}>;

export type ObjectiveStatus = 'holding' | 'advancing' | 'withdrawing' | 'combat-ineffective';

export type RadioMessage =
  | (MessageMeta & Readonly<{ kind: 'TIC'; ownPosition: PositionEstimate; contact: ContactEstimate | null }>)
  | (MessageMeta & Readonly<{ kind: 'CONTACT_REPORT'; contact: ContactEstimate }>)
  | (MessageMeta & Readonly<{ kind: 'POSITION_REPORT'; position: PositionEstimate }>)
  | (MessageMeta &
      Readonly<{
        kind: 'SITREP';
        ownPosition: PositionEstimate;
        personnel: number;
        ammunitionFraction: number;
        status: ObjectiveStatus;
      }>)
  | (MessageMeta & Readonly<{ kind: 'SUPPORT_REQUEST'; ownPosition: PositionEstimate }>)
  | (MessageMeta & Readonly<{ kind: 'COMMAND_UPDATE'; text: string }>)
  | (MessageMeta &
      Readonly<{ kind: 'ACKNOWLEDGEMENT'; support: ExpectedSupport | null; supportCancelled: boolean }>)
  | (MessageMeta & Readonly<{ kind: 'INTEL_REPORT'; contact: ContactEstimate }>)
  | (MessageMeta &
      Readonly<{
        kind: 'STRIKE_RESULT';
        contact: ContactEstimate;
        effect: 'effect-observed' | 'no-effect-observed';
        assessment: StrikeAssessment | null;
      }>)
  | (MessageMeta &
      Readonly<{ kind: 'GROUND_FIRE'; source: PositionEstimate; weapon: WeaponType | null; hit: boolean }>);

// The crew's estimate, never a true count. It exists only when they saw an effect.
export type StrikeAssessment = Readonly<{ estimatedCasualties: number; destroyed: boolean }>;

export type ExpectedSupport = Readonly<{
  aircraftId: string;
  etaAt: number;
  lapsesAt: number;
}>;

export type ReportKind = 'TIC' | 'CONTACT_REPORT' | 'POSITION_REPORT' | 'SITREP' | 'SUPPORT_REQUEST';

// `captured` holds the observation as first noticed (§6.2), so a report still goes out
// if the contact ages out of memory while the report waits in the queue.
export type ReportNeed = Readonly<{ kind: ReportKind; contactId: ContactId | null; captured?: ContactEstimate }>;

export type RadioTaskPhase = 'queued' | 'preparing' | 'transmitting' | 'interrupted';

export type RadioTask = {
  need: ReportNeed;
  priority: number;
  createdAt: number;
  phase: RadioTaskPhase;
  progressSeconds: number;
  sentAt: number | null;
  message: RadioMessage | null;
};

/** What a unit remembers about its own reporting, used to pace new reports. */
export type RadioMemory = Readonly<{
  lastPositionAt: number | null;
  lastTicAt: number | null;
  lastSupportRequestAt: number | null;
  lastSitrepPersonnel: number;
  lastSitrepAt: number | null;
  reportedContacts: Readonly<Record<string, number>>;
  supportAcknowledgedAt: number | null;
}>;

export type UnitStatusForReport = Readonly<{ mode: GroundMode }>;
