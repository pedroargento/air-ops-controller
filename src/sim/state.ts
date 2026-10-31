import { totalAmmunition } from '../domain/public/equipment';
import type { UnitId, UnitKnowledge } from '../domain/public/ground';
import type { GroundUnit, WorldTruth } from '../domain/truth/world';
import { emptyPlayerKnowledge, type PlayerKnowledge } from '../knowledge/player-knowledge';
import { createRng, type RngState } from '../rng/streams';
import type { Scenario } from '../scenario/load';
import { createAircraft } from './air';
import { createRadioState, type RadioState } from './radio';
import { generateWeather } from './weather';

export type SimState = {
  tick: number;
  truth: WorldTruth;
  unitKnowledge: Record<string, UnitKnowledge>;
  radio: RadioState;
  player: PlayerKnowledge;
  rng: RngState;
};

export function createInitialState(scenario: Scenario, seed: number): SimState {
  const { terrain, file } = scenario;
  const rng = createRng(seed);
  const units: GroundUnit[] = scenario.file.units
    .map((unit): GroundUnit => {
      const doctrine = scenario.doctrines[unit.doctrine];
      if (doctrine === undefined) throw new Error(`Unknown doctrine ${unit.doctrine}`);
      return {
        id: unit.id as UnitId,
        name: unit.name,
        side: unit.side,
        position: unit.position,
        navOffset: { x: 0, y: 0 },
        personnel: unit.personnel,
        initialPersonnel: unit.personnel,
        equipment: unit.equipment,
        initialAmmunition: totalAmmunition(unit.equipment),
        firedWeapons: [],
        firesAtAircraft: false,
        nextAirFireTick: 0,
        morale: unit.morale,
        suppression: 0,
        posture: 'defending',
        mode: 'steady',
        behavior: null,
        behaviorSinceTick: 0,
        returnsUsed: 0,
        patrolIndex: 0,
        objective: unit.objective,
        objectiveSchedule: unit.objectiveSchedule.map(({ fromSeconds, objective }) => ({
          fromTick: fromSeconds,
          objective,
        })),
        fallback: unit.fallback,
        doctrine,
        activeFromTick: unit.activeFromSeconds,
        intent: { kind: 'wait' },
        route: [],
        routeDestination: null,
        lastFiredAtTick: null,
        lastHitAtTick: null,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  return {
    tick: 0,
    truth: {
      units,
      aircraft: createAircraft(scenario),
      tracks: {},
      nextContactNumber: 0,
      weather: generateWeather(file.weather, terrain.width * terrain.cellSize, file.durationSeconds, rng),
      captureProgressSeconds: 0,
      outcome: 'running',
      endedAtTick: null,
    },
    unitKnowledge: {},
    radio: createRadioState(units),
    player: emptyPlayerKnowledge(),
    rng,
  };
}
