import type { AirWeapon, Equipment } from './equipment';
import type { ContactEstimate, PositionEstimate } from './estimates';
import { emptyFire, type FireKnowledge } from './fire';
import type { Vec2 } from './geometry';
import type { Poi } from './poi';
import type { ExpectedSupport, Suppression } from './radio';

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
  | Readonly<{ kind: 'AmbushArea'; area: Area; openFireMeters: number; watches?: Vec2 | undefined }>
  | Readonly<{ kind: 'Evade'; area: Area; pickup: Vec2 | null; boardAt: Vec2 | null }>
  | Readonly<{ kind: 'SearchArea'; area: Area }>;

/** Objectives that keep a platoon on its ground. */
export function holdsGround(objective: GroundObjective): objective is Extract<GroundObjective, { kind: 'HoldArea' | 'AmbushArea' }> {
  return objective.kind === 'HoldArea' || objective.kind === 'AmbushArea';
}

export type GroundPosture = 'moving' | 'firing' | 'defending' | 'prone' | 'hidden';

/** A platoon's shared answer to a situation (§4.0.2). */
export type DrillKind = 'nearAmbush' | 'farAmbush' | 'attack' | 'bypass' | 'hastyAmbush' | 'waitForAir' | 'pushThrough';

/** What one squad does in a drill. */
export type SquadRole = 'assault' | 'support' | 'maneuver' | 'cover' | 'bypass' | 'ambush' | 'hold';

export type DrillPhase = 'approach' | 'establish' | 'maneuver' | 'assault';
export type DrillWaitReason = 'support' | 'assembly' | 'doctrine' | 'capacity';
/** CLI-only gate ablations within experimental tactics; these do not enable the master switch. */
export type GroundExperiment = Readonly<{ supportGate: boolean; assemblyGate: boolean; attackReassessment: boolean }>;
/** Own firing activity, with no information about its effects. */
export type GroundVolley = Readonly<{ aim: Vec2; at: number }>;
/** Status shared inside this platoon, never a view of other formations. */
export type SquadStatus = Readonly<{
  id: UnitId; position: Vec2; personnel: number; ammunition: number;
  supportWeapons: number; suppression: number; underFire: boolean;
  role: SquadRole | null; viaDone: boolean; groundVolley: GroundVolley | null;
}>;
export type DrillCoordination = Readonly<{
  phase: DrillPhase;
  roles: Readonly<Record<string, SquadRole>>;
  waitReason: DrillWaitReason | null;
}>;

export type Drill = Readonly<{
  kind: DrillKind;
  startedAt: number;
  target: Vec2;
  radius: number;
  /** Where flankers go before they close. */
  via: Vec2 | null;
  /** The enemy's position, for routes to keep clear of. */
  avoid: Area | null;
  /** Started on a warning, so the platoon isn't caught by surprise. */
  warned: boolean;
  /** Own movement progress, used to distinguish a slow maneuver from a stalled one. */
  progress?: Readonly<{ at: number; remainingMeters: number }>;
  /** Cumulative own waiting, never inferred from enemy state. */
  supportWait?: Readonly<{ seconds: number; checkedAt: number; waiting: boolean }>;
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
  /** Resolved from the scenario's ground.experimentalTactics switch. */
  experimentalTactics: boolean;
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
  illuminationRounds: number;
  waitForAirStrengthRatio: number;
  radioSilent: boolean;
  /** Under fire, aims its reaction at the shooter, or fires back toward unseen fire (§4.0.3). */
  reactToFire: boolean;
  blindFireRangeMeters: number;
  /** Holds for its wounded below this share of men free to fight; null never (§4.1.1). */
  woundedHoldShare: number | null;
  airRefusedMemorySeconds: number;
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
  supportFireMemorySeconds: number;
  supportWaitSeconds: number | null;
  flankMeters: number;
  warningMeters: number;
  corridorMeters: number;
  clearSeconds: number;
  /** How far a platoon on the move pulls back to rally. Null falls back to its authored area. */
  rallyMeters: number | null;
  airWaitSeconds: number;
  groupRadiusMeters: number;
  arrivedMeters: number;
  sidestepMeters: number;
  breakContactMeters: number;
  assaultAmmunitionFraction: number;
  noSupportWeaponsAssaultFactor: number;
  objectiveMarginMeters: number;
  attackRadiusMeters: number;
  headingTowardsCos: number;
}>;

/** What a formation knows about itself and its own squads, never other formations. */
export type UnitSelf = Readonly<{
  id: UnitId;
  side: Side;
  position: Vec2;
  /** Place in the platoon's layout, as a fraction of an area's radius. */
  slot: Vec2;
  /** Everyone in the platoon, the strength a unit weighs against an enemy. */
  platoonPersonnel: number;
  /** Wounded the squad carries, and across its platoon: fit men tied down carrying them (§4.1.1). */
  wounded: number;
  platoonWounded: number;
  /** The platoon's fit men not carrying wounded, and its strength at the start. */
  platoonFree: number;
  platoonInitialPersonnel: number;
  /** How long the platoon's longest-waiting wounded have waited, or null with none. */
  woundedWaitSeconds: number | null;
  squads: number;
  drill: Drill | null;
  drillPhase: DrillPhase | null;
  ownSquads: readonly SquadStatus[];
  groundVolley: GroundVolley | null;
  role: SquadRole | null;
  /** A flanker that has reached its flank point and can now close. */
  viaDone: boolean;
  ambushSprung: boolean;
  handled: readonly HandledPosition[];
  /** Where the unit's own route goes next. */
  routeAhead: readonly Vec2[];
  secondsLeft: number;
  /** Whether it can call Air Ops itself. */
  canCallAir: boolean;
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

/** A completed position, failed attempt, or unanswered request; each has its own expiry rule. */
export type HandledPosition = Readonly<{ center: Vec2; tick: number; askedAir?: boolean; failed?: boolean; reason?: 'support-timeout' }>;

export type NoticedAircraft = Readonly<{ position: Vec2; altitudeMeters: number; seenAt: number }>;

export type UnitKnowledge = {
  // The unit's own tracks, which it can engage.
  contacts: Record<string, ContactEstimate>;
  // Information received from others, keyed by source and contact.
  reports: Record<string, ContactEstimate>;
  // Places the player has marked, keyed by mark.
  pois: Record<string, Poi>;
  /** Where air operations told a downed aircrew to be picked up. */
  pickup?: Vec2;
  /** Suppression missions announced on the net, by aircraft. */
  suppressions: Record<string, Suppression>;
  expectedSupport: ExpectedSupport | null;
  supportRefusedAt: number | null;
  /** When air operations last answered its medevac request, yes or no (§8.9). */
  medevacAnsweredAt: number | null;
  hostileAircraftSeenAt: number | null;
  noticedAircraft: NoticedAircraft | null;
  /** Its own fight: fire on it, where from, and what it is firing at (§7.3). */
  fire: FireKnowledge;
};

export function emptyKnowledge(): UnitKnowledge {
  return { contacts: {}, reports: {}, pois: {}, suppressions: {}, expectedSupport: null, supportRefusedAt: null, medevacAnsweredAt: null, hostileAircraftSeenAt: null, noticedAircraft: null, fire: emptyFire() };
}

export type GroundIntent =
  | Readonly<{ kind: 'wait' }>
  | Readonly<{ kind: 'hold'; posture: GroundPosture }>
  | Readonly<{ kind: 'move'; destination: Vec2 }>
  | Readonly<{ kind: 'engage'; aim: Vec2; closeTo: Vec2 | null; fireRate: number; prepared: boolean }>;

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
  coordination: DrillCoordination | null;
  ambushSprung: boolean;
  objectiveDone: boolean;
  fallback: Area;
  handled: readonly HandledPosition[];
}>;
