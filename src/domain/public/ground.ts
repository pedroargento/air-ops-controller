import type { ContactEstimate, PositionEstimate } from './estimates';
import type { Vec2 } from './geometry';
import type { ExpectedSupport } from './radio';

export type Side = 'friendly' | 'enemy';
export type UnitId = string & { readonly __brand: 'UnitId' };
export type ContactId = string & { readonly __brand: 'ContactId' };

export type Area = Readonly<{ center: Vec2; radius: number }>;

export type GroundObjective =
  | Readonly<{ kind: 'HoldArea'; area: Area }>
  | Readonly<{ kind: 'MoveTo'; area: Area }>
  | Readonly<{ kind: 'PatrolArea'; waypoints: readonly Vec2[] }>
  | Readonly<{ kind: 'WithdrawTo'; area: Area }>;

export type GroundPosture = 'moving' | 'firing' | 'defending' | 'prone';

// `steady` units pursue their objective. `withdrawing` units head for their
// fallback, `recovering` units regroup there, and `broken` units stay out of the fight.
export type GroundMode = 'steady' | 'withdrawing' | 'recovering' | 'broken';

export type Doctrine = Readonly<{
  speedMps: number;
  detectRangeMeters: number;
  observerQuality: number;
  engageRangeMeters: number;
  closesToMeters: number | null;
  pinnedSuppression: number;
  withdrawCasualties: number;
  withdrawMorale: number;
  withdrawSuppression: number;
  returnMorale: number;
  returnSuppression: number;
  returnMaxCasualties: number;
  returnMinAmmoFraction: number;
  maxReturns: number;
  alertRadiusMeters: number;
  avoidStrengthRatio: number;
  delayStrengthRatio: number;
  supportHoldBonus: number;
  reportMemorySeconds: number;
  airCoverSeconds: number;
}>;

/** What a formation knows about itself. Contains nothing about other units. */
export type UnitSelf = Readonly<{
  id: UnitId;
  side: Side;
  position: Vec2;
  ownPosition: PositionEstimate;
  personnel: number;
  initialPersonnel: number;
  ammunition: number;
  initialAmmunition: number;
  morale: number;
  suppression: number;
  underFire: boolean;
  mode: GroundMode;
  returnsUsed: number;
  patrolIndex: number;
  objective: GroundObjective;
  fallback: Area;
  doctrine: Doctrine;
}>;

export type UnitKnowledge = {
  // The unit's own tracks, which it can engage.
  contacts: Record<string, ContactEstimate>;
  // Information received from others, keyed by source and contact.
  reports: Record<string, ContactEstimate>;
  expectedSupport: ExpectedSupport | null;
  hostileAircraftSeenAt: number | null;
};

export function emptyKnowledge(): UnitKnowledge {
  return { contacts: {}, reports: {}, expectedSupport: null, hostileAircraftSeenAt: null };
}

export type GroundIntent =
  | Readonly<{ kind: 'wait' }>
  | Readonly<{ kind: 'hold'; posture: GroundPosture }>
  | Readonly<{ kind: 'move'; destination: Vec2 }>
  | Readonly<{ kind: 'engage'; contactId: ContactId; closeTo: Vec2 | null }>;

export type GroundDecision = Readonly<{
  intent: GroundIntent;
  mode: GroundMode;
  returnsUsed: number;
  patrolIndex: number;
}>;
