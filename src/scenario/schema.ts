import { z } from 'zod';

const unit = z.number().min(0).max(1);
const vec2 = z.object({ x: z.number(), y: z.number() });
const area = z.object({ center: vec2, radius: z.number().positive() });

const terrainClass = z.object({
  terrainClass: z.string(),
  moveCost: z.number().positive(),
  groundCover: unit,
  airCover: unit,
  groundConcealment: unit,
  airConcealment: unit,
  groundObstruction: unit,
  airObstruction: unit,
});

const objective = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('HoldArea'), area }),
  z.object({ kind: z.literal('MoveTo'), area }),
  z.object({ kind: z.literal('PatrolArea'), waypoints: z.array(vec2).min(1) }),
  z.object({ kind: z.literal('WithdrawTo'), area }),
]);

const doctrine = z.object({
  speedMps: z.number().positive(),
  detectRangeMeters: z.number().positive(),
  observerQuality: z.number().positive(),
  alertRadiusMeters: z.number().positive(),
  avoidStrengthRatio: z.number().positive(),
  delayStrengthRatio: z.number().positive(),
  supportHoldBonus: unit,
  reportMemorySeconds: z.number().positive(),
  airCoverSeconds: z.number().min(0),
  airCoverRepeatSeconds: z.number().int().positive(),
  standoffMeters: z.number().positive(),
  observeBias: z.number().nonnegative(),
  probeBias: z.number().nonnegative(),
  harassBias: z.number().nonnegative(),
  assaultBias: z.number().nonnegative(),
  burstSeconds: z.number().int().positive(),
  pauseSeconds: z.number().int().min(0),
  pressureMoraleFloor: unit,
  airFireThreshold: unit,
  engageRangeMeters: z.number().positive(),
  closesToMeters: z.number().positive().nullable(),
  pinnedSuppression: unit,
  withdrawCasualties: unit,
  withdrawMorale: unit,
  withdrawSuppression: unit,
  returnMorale: unit,
  returnSuppression: unit,
  returnMaxCasualties: unit,
  returnMinAmmoFraction: unit,
  maxReturns: z.number().int().min(0),
});

const weapon = z.object({
  targetDomains: z.array(z.enum(['GROUND', 'AIR'])).min(1),
  rangeMeters: z.number().positive(),
  suppressionEffect: z.number().nonnegative(),
  damageEffect: z.number().nonnegative(),
  crewRequired: z.number().int().positive(),
  ammunitionPerUse: z.number().positive(),
  maxAltitudeMeters: z.number().min(0),
  airHitChance: unit,
  airCycleSeconds: z.number().int().positive(),
});

const combat = z.object({
  weapons: z.object({ SMALL_ARMS: weapon, MACHINE_GUN: weapon, AAA: weapon, MANPADS: weapon }),
  systemLossPerCasualtyFraction: z.number().nonnegative(),
  assessmentNoise: unit,
  suppressionFirePenalty: unit,
  movingFirePenalty: unit,
  minRangeFactor: unit,
  assessmentSigmaMeters: z.number().positive(),
  suppressionDecayPerUpdate: unit,
  moraleLossPerCasualtyFraction: z.number().nonnegative(),
  moraleLossUnderFirePerUpdate: z.number().nonnegative(),
  moraleLossDeterioratingPerUpdate: z.number().nonnegative(),
  isolationRadiusMeters: z.number().positive(),
  lowAmmunitionFraction: unit,
  moraleRecoveryOutOfContactPerUpdate: z.number().nonnegative(),
  outOfContactSeconds: z.number().int().positive(),
  behaviorFireRate: z.object({ observe: unit, probe: unit, harass: unit, assault: unit, disengage: unit }),
  moraleRecoveryPerUpdate: z.number().nonnegative(),
  moraleRecoveryCap: unit,
  postureCover: z.object({ moving: unit, firing: unit, defending: unit, prone: unit }),
});

const perception = z.object({
  baseDetectionPerScan: unit,
  movingBoost: z.number().min(1),
  firingBoost: z.number().min(1),
  trackedBoost: z.number().min(1),
  postureConcealment: z.object({ moving: unit, firing: unit, defending: unit, prone: unit }),
  identifyPerScan: unit,
  weaponSeenPerScan: unit,
  sigmaBaseMeters: z.number().positive(),
  sigmaRangeFraction: z.number().nonnegative(),
  sigmaConcealmentFactor: z.number().nonnegative(),
  sigmaSuppressionFactor: z.number().nonnegative(),
  observableFraction: unit,
  strengthNoise: unit,
  motionObservedPerScan: unit,
  headingNoiseRad: z.number().nonnegative(),
  contactMemorySeconds: z.number().int().positive(),
  engageMemorySeconds: z.number().int().positive(),
  revisionMoveMeters: z.number().positive(),
  revisionRangeImprovement: unit,
  highConfidenceSigmaMeters: z.number().positive(),
  mediumConfidenceSigmaMeters: z.number().positive(),
  navSigmaMeters: z.number().positive(),
  navDriftPerMeter: z.number().nonnegative(),
});

const radio = z.object({
  prepareSeconds: z.number().positive(),
  transmitSeconds: z.number().positive(),
  engagedRate: unit,
  withdrawingRate: unit,
  interruptSuppression: unit,
  positionIntervalSeconds: z.number().int().positive(),
  ticCooldownSeconds: z.number().int().positive(),
  supportRequestCooldownSeconds: z.number().int().positive(),
  sitrepCasualtyStep: unit,
  sitrepIntervalSeconds: z.number().int().positive(),
  contactReportIntervalSeconds: z.number().int().positive(),
  ticRangeMeters: z.number().positive(),
  ticStrengthRatio: z.number().positive(),
  ticCasualtyFraction: unit,
  supportStrengthRatio: z.number().positive(),
  supportCasualtyFraction: unit,
  supportAmmunitionFraction: unit,
});

const display = z.object({
  opacityFloor: unit,
  fadeSeconds: z.number().positive(),
  plausibleSpeedMps: z.number().positive(),
  coneBaseHalfAngleRad: z.number().positive(),
  coneWidenRadPerSecond: z.number().nonnegative(),
  freshReportSeconds: z.number().positive(),
  regionMaxRadiusMeters: z.number().positive(),
  regionFadeSeconds: z.number().positive(),
  effectSeconds: z.number().positive(),
  groundFireMarkSeconds: z.number().positive(),
  groundFireMergeMeters: z.number().positive(),
  threatRiskPerMinute: unit,
  archiveSeconds: z.number().positive(),
  destroyedShowSeconds: z.number().positive(),
  notFoundShowSeconds: z.number().positive(),
  friendlySilentSeconds: z.number().positive(),
  consolidateMaxAgeSeconds: z.number().positive(),
  notFoundMinAgeSeconds: z.number().positive(),
  notFoundLookSeconds: z.number().positive(),
  notFoundCoverage: unit,
  hqEnemyEstimate: z.number().positive(),
  summaryRatioRadiusMeters: z.number().positive(),
  summaryStaleSeconds: z.number().positive(),
});

const aircraftModel = z.object({
  role: z.enum(['recon', 'cas']),
  displayName: z.string(),
  rotary: z.boolean(),
  terrainClearanceMeters: z.number().positive(),
  defaultAltitudeMeters: z.number().positive(),
  sensorFalloffMeters: z.number().positive(),
  strikeMissPerMeterAltitude: z.number().nonnegative(),
  passIntervalSeconds: z.number().int().positive(),
  casualtyFractionPerPass: unit,
  suppressionPerPass: unit,
  moralePerPass: unit,
  hitChanceFactor: z.number().nonnegative(),
  hitSurvivalChance: unit,
  speedMps: z.number().positive(),
  fuelSeconds: z.number().positive(),
  ammunition: z.number().int().min(0),
  takeoffSeconds: z.number().int().min(0),
  turnaroundSeconds: z.number().int().min(0),
  repairSeconds: z.number().int().min(0),
  bingoMarginSeconds: z.number().int().min(0),
  sensorRadiusMeters: z.number().positive(),
  observerQuality: z.number().positive(),
  orbitRadiusMeters: z.number().positive(),
  turnRateRadPerSecond: z.number().positive(),
  climbRateMps: z.number().positive(),
  minAltitudeMeters: z.number().positive(),
  maxAltitudeMeters: z.number().positive(),
});

const air = z.object({
  airbase: vec2,
  operatingAltitudeMeters: z.number().positive(),
  sensorReferenceHeightMeters: z.number().positive(),
  terrainLookaheadSeconds: z.number().positive(),
  sensorQualityMin: unit,
  sensorQualityMax: z.number().min(1),
  groundFireSigmaMeters: z.number().positive(),
  groundFireWeaponSeenChance: unit,
  groundFireReportSeconds: z.number().int().positive(),
  models: z.record(z.string(), aircraftModel),
  aircraft: z.array(z.object({ id: z.string(), model: z.string() })),
  groundNoticeRangeMeters: z.number().positive(),
  groundNoticePerScan: unit,
  sightingDedupeMeters: z.number().positive(),
  cueRadiusMeters: z.number().positive(),
  cueMaxAgeSeconds: z.number().positive(),
  cueDetectionBoost: z.number().min(1),
  blastRadiusMeters: z.number().positive(),
  supportAckDistanceMeters: z.number().positive(),
  supportGraceSeconds: z.number().int().min(0),
  supportEtaSlipSeconds: z.number().int().positive(),
});

const capture = z.object({
  area,
  enemyMinEffective: z.number().nonnegative(),
  defenderMinEffective: z.number().nonnegative(),
  holdSeconds: z.number().int().positive(),
  successMinDefenders: z.number().nonnegative(),
});

const groundUnit = z.object({
  id: z.string(),
  name: z.string(),
  side: z.enum(['friendly', 'enemy']),
  position: vec2,
  personnel: z.number().int().positive(),
  equipment: z
    .array(
      z.object({
        weapon: z.enum(['SMALL_ARMS', 'MACHINE_GUN', 'AAA', 'MANPADS']),
        quantity: z.number().int().positive(),
        ammunition: z.number().positive(),
      }),
    )
    .min(1),
  morale: unit,
  doctrine: z.string(),
  objective,
  fallback: area,
  activeFromSeconds: z.number().int().min(0).default(0),
  objectiveSchedule: z.array(z.object({ fromSeconds: z.number().int().min(0), objective })).default([]),
});

export const scenarioFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  durationSeconds: z.number().int().positive(),
  terrain: z.object({
    cellSizeMeters: z.number().positive(),
    elevationStepMeters: z.number().positive(),
    legend: z.record(z.string().length(1), terrainClass),
    classLayer: z.string(),
    elevationLayer: z.string(),
  }),
  doctrines: z.record(z.string(), doctrine),
  combat,
  perception,
  radio,
  display,
  air,
  capture,
  links: z.array(z.tuple([z.string(), z.string()])),
  ceconMessages: z.array(z.object({ atSeconds: z.number().int().min(0), text: z.string() })).default([]),
  units: z.array(groundUnit).min(1),
});

export type ScenarioFile = z.infer<typeof scenarioFileSchema>;
export type CombatConfig = ScenarioFile['combat'];
export type CaptureConfig = ScenarioFile['capture'];
export type AirConfig = ScenarioFile['air'];
export type AircraftModelConfig = z.infer<typeof aircraftModel>;
export type PerceptionConfig = ScenarioFile['perception'];
export type RadioConfig = ScenarioFile['radio'];
export type DisplayConfig = ScenarioFile['display'];
