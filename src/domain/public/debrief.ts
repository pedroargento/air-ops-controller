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
}>;
