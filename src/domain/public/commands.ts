import type { AircraftId, AircraftOrder, RiskLimit, WeaponsControl } from './air';
import type { Vec2 } from './geometry';
import type { PoiKind } from './poi';

export type ReportRequest = 'position' | 'sitrep' | 'contact';

// Player commands are stamped with the tick they apply to, which makes a
// command log replayable. No command can order a ground unit to move or attack.
export type PlayerCommand =
  | Readonly<{ kind: 'noop'; tick: number }>
  | Readonly<{ kind: 'aircraftOrder'; tick: number; aircraftId: AircraftId; order: AircraftOrder }>
  | Readonly<{ kind: 'setAltitude'; tick: number; aircraftId: AircraftId; meters: number }>
  | Readonly<{ kind: 'releaseAltitude'; tick: number; aircraftId: AircraftId }>
  | Readonly<{ kind: 'setRisk'; tick: number; aircraftId: AircraftId; risk: RiskLimit }>
  | Readonly<{ kind: 'setWeapons'; tick: number; aircraftId: AircraftId; weapons: WeaponsControl }>
  | Readonly<{ kind: 'forwardContact'; tick: number; contactKey: string; recipients: readonly string[] }>
  | Readonly<{
      kind: 'reportPoi';
      tick: number;
      poiKind: PoiKind;
      center: Vec2;
      radiusMeters: number;
      recipients: readonly string[];
    }>
  | Readonly<{ kind: 'cancelPoi'; tick: number; poiId: string }>
  | Readonly<{ kind: 'answerDangerClose'; tick: number; unitId: string; approved: boolean }>
  | Readonly<{ kind: 'requestReport'; tick: number; unitId: string; report: ReportRequest }>
  | Readonly<{ kind: 'acknowledge'; tick: number; unitId: string; casAircraftId: AircraftId | null }>;

type WithoutTick<T> = T extends unknown ? Omit<T, 'tick'> : never;

/** A command before the session stamps it with the tick it applies to. */
export type PlayerAction = WithoutTick<PlayerCommand>;
