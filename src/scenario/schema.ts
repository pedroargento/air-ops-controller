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

const combat = z.object({
  lethalityPerManVolley: z.number().nonnegative(),
  suppressionPerManVolley: z.number().nonnegative(),
  ammoPerManVolley: z.number().nonnegative(),
  suppressionFirePenalty: unit,
  movingFirePenalty: unit,
  minRangeFactor: unit,
  assessmentSigmaMeters: z.number().positive(),
  suppressionDecayPerUpdate: unit,
  moraleLossPerCasualtyFraction: z.number().nonnegative(),
  moraleLossUnderFirePerUpdate: z.number().nonnegative(),
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
});

const aircraftType = z.object({
  speedMps: z.number().positive(),
  fuelSeconds: z.number().positive(),
  ammunition: z.number().int().min(0),
  takeoffSeconds: z.number().int().min(0),
  turnaroundSeconds: z.number().int().min(0),
  bingoMarginSeconds: z.number().int().min(0),
  sensorRadiusMeters: z.number().positive(),
  observerQuality: z.number().positive(),
  orbitRadiusMeters: z.number().positive(),
  turnRateRadPerSecond: z.number().positive(),
});

const air = z.object({
  airbase: vec2,
  types: z.object({ recon: aircraftType, cas: aircraftType }),
  aircraft: z.array(z.object({ id: z.string(), aircraftType: z.enum(['recon', 'cas']) })),
  groundNoticeRangeMeters: z.number().positive(),
  groundNoticePerScan: unit,
  sightingDedupeMeters: z.number().positive(),
  cueRadiusMeters: z.number().positive(),
  cueMaxAgeSeconds: z.number().positive(),
  cueDetectionBoost: z.number().min(1),
  passIntervalSeconds: z.number().int().positive(),
  casualtyFractionPerPass: unit,
  suppressionPerPass: unit,
  moralePerPass: unit,
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
  ammunition: z.number().positive(),
  morale: unit,
  doctrine: z.string(),
  objective,
  fallback: area,
  activeFromSeconds: z.number().int().min(0).default(0),
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
export type AircraftTypeConfig = AirConfig['types']['cas'];
export type PerceptionConfig = ScenarioFile['perception'];
export type RadioConfig = ScenarioFile['radio'];
export type DisplayConfig = ScenarioFile['display'];
