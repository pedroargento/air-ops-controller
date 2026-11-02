import type { WeaponType } from './equipment';
import type { ContactEstimate, PositionEstimate } from './estimates';
import type { ContactId, DrillKind, GroundMode } from './ground';
import type { SupportWeapons } from './air';
import type { Vec2 } from './geometry';
import type { Poi } from './poi';

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
  | (MessageMeta &
      Readonly<{
        kind: 'SUPPORT_REQUEST';
        ownPosition: PositionEstimate;
        dangerClose: boolean;
        wants: SupportWeapons;
        target: Vec2 | null;
      }>)
  | (MessageMeta & Readonly<{ kind: 'CHECK_FIRE'; ownPosition: PositionEstimate }>)
  | (MessageMeta & Readonly<{ kind: 'DANGER_CLOSE_HOLD'; aim: Vec2 }>)
  | (MessageMeta & Readonly<{ kind: 'DRILL'; ownPosition: PositionEstimate; drill: DrillKind }>)
  | (MessageMeta & Readonly<{ kind: 'COMMAND_UPDATE'; text: string }>)
  | (MessageMeta &
      Readonly<{ kind: 'ACKNOWLEDGEMENT'; support: ExpectedSupport | null; supportCancelled: boolean }>)
  | (MessageMeta & Readonly<{ kind: 'INTEL_REPORT'; contact: ContactEstimate }>)
  | (MessageMeta & Readonly<{ kind: 'POI_REPORT'; poi: Poi; cancelled: boolean }>)
  | (MessageMeta & Readonly<{ kind: 'SUPPRESSION'; suppression: Suppression; cancelled: boolean }>)
  | (MessageMeta &
      Readonly<{
        kind: 'STRIKE_RESULT';
        aim: Vec2;
        /** What the crew aimed at, or null for a pass on a place (Suppress or Strike). */
        contact: ContactEstimate | null;
        effect: 'effect-observed' | 'no-effect-observed';
        assessment: StrikeAssessment | null;
      }>)
  | (MessageMeta &
      Readonly<{ kind: 'GROUND_FIRE'; source: PositionEstimate; weapon: WeaponType | null; hit: boolean; damaged: boolean }>);

/** A suppression mission as air operations announces it on the net: where, and when. */
export type Suppression = Readonly<{
  aircraftId: string;
  center: Vec2;
  radius: number;
  fromTick: number;
  untilTick: number;
}>;

// The crew's estimate, never a true count. It exists only when they saw an effect.
export type StrikeAssessment = Readonly<{ estimatedCasualties: number; destroyed: boolean }>;

export type ExpectedSupport = Readonly<{
  aircraftId: string;
  etaAt: number;
  lapsesAt: number;
}>;

export type ReportKind = 'TIC' | 'CONTACT_REPORT' | 'POSITION_REPORT' | 'SITREP' | 'SUPPORT_REQUEST' | 'DRILL' | 'CHECK_FIRE';

// `captured` holds the observation as first noticed (§6.2), so a report still goes out
// if the contact ages out of memory while the report waits in the queue.
export type ReportNeed = Readonly<{
  kind: ReportKind;
  contactId: ContactId | null;
  captured?: ContactEstimate;
  drill?: DrillKind;
  dangerClose?: boolean;
  wants?: SupportWeapons;
  target?: Vec2;
}>;

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
  lastDangerCloseAt: number | null;
  lastSitrepPersonnel: number;
  lastSitrepAt: number | null;
  reportedContacts: Readonly<Record<string, number>>;
  supportAcknowledgedAt: number | null;
}>;

export type UnitStatusForReport = Readonly<{ mode: GroundMode }>;

/** How much a message needs the player: urgent ones stand out, routine ones stay in the full log. */
export type ReportLevel = 'urgent' | 'main' | 'routine';

export function reportLevel(message: RadioMessage): ReportLevel {
  switch (message.kind) {
    case 'TIC':
    case 'SUPPORT_REQUEST':
    case 'GROUND_FIRE':
    case 'CHECK_FIRE':
    case 'DANGER_CLOSE_HOLD':
      return 'urgent';
    case 'CONTACT_REPORT':
    case 'SITREP':
    case 'DRILL':
    case 'STRIKE_RESULT':
    case 'COMMAND_UPDATE':
      return 'main';
    case 'POSITION_REPORT':
    case 'ACKNOWLEDGEMENT':
    case 'INTEL_REPORT':
    case 'POI_REPORT':
    case 'SUPPRESSION':
      return 'routine';
  }
}
