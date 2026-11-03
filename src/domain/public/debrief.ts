/** What really happened, available only once a run is over. */
export type Debrief = Readonly<{
  enemyStart: number;
  enemyLeft: number;
  enemyFormations: number;
  enemyDestroyed: number;
  enemyBroken: number;
  friendlyStart: number;
  friendlyLeft: number;
  friendlyDestroyed: number;
  friendlyFireCasualties: number;
  /** Share of the enemy your picture had about right, on a search mission. */
  locatedShare: number | null;
  /** Enemy casualties claimed by crews' strike assessments and by ground units, against the truth. */
  airClaims: number;
  groundClaims: number;
  /** How good each source's reports really were. */
  sources: readonly SourceScore[];
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
