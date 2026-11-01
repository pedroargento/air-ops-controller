import type { AirWeapon, Equipment } from './equipment';
import type { ContactEstimate, PositionEstimate } from './estimates';
import type { Vec2 } from './geometry';
import type { Poi } from './poi';
import type { ExpectedSupport } from './radio';

export type Side = 'friendly' | 'enemy';
export type UnitId = string & { readonly __brand: 'UnitId' };
export type ContactId = string & { readonly __brand: 'ContactId' };

export type Area = Readonly<{ center: Vec2; radius: number }>;

export type GroundObjective =
  | Readonly<{ kind: 'HoldArea'; area: Area }>
  | Readonly<{ kind: 'MoveTo'; area: Area }>
  | Readonly<{ kind: 'PatrolArea'; waypoints: readonly Vec2[] }>
  | Readonly<{ kind: 'WithdrawTo'; area: Area }>
  | Readonly<{ kind: 'AssaultArea'; area: Area }>
  | Readonly<{ kind: 'AmbushArea'; area: Area; openFireMeters: number; watches?: Vec2 | undefined }>;

export type GroundPosture = 'moving' | 'firing' | 'defending' | 'prone' | 'hidden';

/** A platoon's shared answer to a situation (§4.0.2). */
export type DrillKind = 'nearAmbush' | 'farAmbush' | 'attack' | 'bypass' | 'hastyAmbush' | 'waitForAir';

/** What one squad does in a drill. */
export type SquadRole = 'assault' | 'support' | 'maneuver' | 'cover' | 'bypass' | 'ambush' | 'hold';

export type Drill = Readonly<{
  kind: DrillKind;
  startedAt: number;
  target: Vec2;
  radius: number;
  /** Where flankers go before they close. */
  via: Vec2 | null;
  /** The enemy's position, for routes to keep clear of. */
  avoid: Area | null;
}>;

/** What a platoon can ask of the map. Answers come from terrain, never from truth. */
export type DrillMap = Readonly<{
  routeMeters: (from: Vec2, to: Vec2, avoid: Area | null) => number;
  sees: (from: Vec2, to: Vec2) => boolean;
  cover: (point: Vec2) => number;
}>;

// `steady` units pursue their objective. `withdrawing` units head for their
// fallback, `recovering` units regroup there, and `broken` units stay out of the fight.
export type GroundMode = 'steady' | 'withdrawing' | 'recovering' | 'broken';

// What a formation does about an enemy it knows of (§4.0). Null means it knows of none.
export type GroundBehavior = 'observe' | 'probe' | 'harass' | 'assault' | 'disengage';

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
  airCoverRepeatSeconds: number;
  standoffMeters: number;
  observeBias: number;
  probeBias: number;
  harassBias: number;
  assaultBias: number;
  burstSeconds: number;
  pauseSeconds: number;
  pressureMoraleFloor: number;
  airFireThreshold: number;
  drills: readonly DrillKind[];
  nearAmbushMeters: number;
  drillSeconds: number;
  attackStrengthRatio: number;
  maxDetourFactor: number;
  supportShare: number;
  flankMeters: number;
  warningMeters: number;
  corridorMeters: number;
  clearSeconds: number;
  /** How far a platoon on the move pulls back to rally. Null falls back to its authored area. */
  rallyMeters: number | null;
}>;

/** What a formation knows about itself. Contains nothing about other units. */
export type UnitSelf = Readonly<{
  id: UnitId;
  side: Side;
  position: Vec2;
  /** Place in the platoon's layout, as a fraction of an area's radius. */
  slot: Vec2;
  /** Everyone in the platoon, the strength a unit weighs against an enemy. */
  platoonPersonnel: number;
  squads: number;
  drill: Drill | null;
  role: SquadRole | null;
  /** A flanker that has reached its flank point and can now close. */
  viaDone: boolean;
  ambushSprung: boolean;
  handled: readonly HandledPosition[];
  /** Where the unit's own route goes next. */
  routeAhead: readonly Vec2[];
  secondsLeft: number;
  ownPosition: PositionEstimate;
  personnel: number;
  initialPersonnel: number;
  ammunition: number;
  initialAmmunition: number;
  equipment: readonly Equipment[];
  supportWeapons: number;
  airWeapons: readonly AirWeapon[];
  morale: number;
  suppression: number;
  underFire: boolean;
  mode: GroundMode;
  behavior: GroundBehavior | null;
  behaviorSinceTick: number;
  groundCover: number;
  returnsUsed: number;
  patrolIndex: number;
  objective: GroundObjective;
  fallback: Area;
  doctrine: Doctrine;
}>;

/** A position the platoon has dealt with. */
export type HandledPosition = Readonly<{ center: Vec2; tick: number }>;

export type NoticedAircraft = Readonly<{ position: Vec2; altitudeMeters: number; seenAt: number }>;

export type UnitKnowledge = {
  // The unit's own tracks, which it can engage.
  contacts: Record<string, ContactEstimate>;
  // Information received from others, keyed by source and contact.
  reports: Record<string, ContactEstimate>;
  // Places the player has marked, keyed by mark.
  pois: Record<string, Poi>;
  expectedSupport: ExpectedSupport | null;
  hostileAircraftSeenAt: number | null;
  noticedAircraft: NoticedAircraft | null;
};

export function emptyKnowledge(): UnitKnowledge {
  return { contacts: {}, reports: {}, pois: {}, expectedSupport: null, hostileAircraftSeenAt: null, noticedAircraft: null };
}

export type GroundIntent =
  | Readonly<{ kind: 'wait' }>
  | Readonly<{ kind: 'hold'; posture: GroundPosture }>
  | Readonly<{ kind: 'move'; destination: Vec2 }>
  | Readonly<{ kind: 'engage'; contactId: ContactId; closeTo: Vec2 | null; fireRate: number; prepared: boolean }>;

export type GroundDecision = Readonly<{
  intent: GroundIntent;
  behavior: GroundBehavior | null;
  behaviorSinceTick: number;
  firesAtAircraft: boolean;
  patrolIndex: number;
  viaDone: boolean;
  avoid: Area | null;
}>;

export type PlatoonDecision = Readonly<{
  mode: GroundMode;
  returnsUsed: number;
  drill: Drill | null;
  ambushSprung: boolean;
  objectiveDone: boolean;
  fallback: Area;
  handled: readonly HandledPosition[];
}>;
