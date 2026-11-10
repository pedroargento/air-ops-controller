/** What really happened, available only once a run is over. */
export type Debrief = Readonly<{
  mission: Readonly<{ name: string; objective: string; result: string; elapsedSeconds: number; evidence: readonly string[] }>;
  aircraft: readonly AircraftPerformance[];
  enemyStart: number;
  enemyLeft: number;
  enemyFormations: number;
  enemyDestroyed: number;
  enemyBroken: number;
  friendlyStart: number;
  friendlyLeft: number;
  friendlyDestroyed: number;
  friendlyFireCasualties: number;
  /** What became of each side's casualties (§4.1.1, §8.9). */
  casualties: Readonly<Record<'friendly' | 'enemy', CasualtyOutcome>>;
  /** Share of the enemy your picture had about right, on a search mission. */
  locatedShare: number | null;
  /** Enemy casualties claimed by crews' strike assessments and by ground units, against the truth. */
  airClaims: number;
  groundClaims: number;
  /** How good each source's reports really were. */
  sources: readonly SourceScore[];
}>;

export type CasualtyOutcome = Readonly<{
  killed: number;
  wounded: number;
  diedOfWounds: number;
  evacuated: number;
  /** Wounded in a helicopter on its way to hospital when the run ended. */
  aboard: number;
  /** Wounded still with their units when the run ended. */
  waiting: number;
  /** Mean minutes from wound to hospital for those evacuated, or null if nobody was. */
  hospitalMinutes: number | null;
}>;

/** Where every squad really was at one moment: kept by the session, shown only after the run. */
export type TruthFrame = Readonly<{
  tick: number;
  squads: readonly Readonly<{ id: string; side: 'friendly' | 'enemy'; x: number; y: number; alive: boolean }>[];
}>;

export type SourceScore = Readonly<{
  sourceId: string;
  reports: number;
  /** How far off its estimates were, on average, from where the unit really was. */
  meanErrorMeters: number;
  /** Friendly units it reported as hostile. */
  misidentified: number;
  claimed: number;
  /** Admiralty source reliability, A (completely reliable) to E (unreliable), from the above. */
  reliability: string;
}>;

/** Contributions are separate measures, never an overall grade. */
export type AircraftPerformance = Readonly<{
  aircraftId: string; model: string; role: string; rescueCapable: boolean; flareCapable: boolean;
  airborneSeconds: number; stationSeconds: number; landedSeconds: number;
  damageIncidents: number; repairSeconds: number;
  bombs: number; gunBursts: number; flares: number; illuminationSeconds: number;
  enemyCasualties: number; friendlyCasualties: number;
  enemySquadsSeen: number; firstAirSightings: number; meanObservationErrorMeters: number | null;
  woundedDelivered: number; hospitalMinutes: number | null; woundedAboard: number;
  survivorsDelivered: number; survivorsAboard: number;
  sorties: readonly Readonly<{ departedAt: number; returnedAt: number | null }>[];
}>;
