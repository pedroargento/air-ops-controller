import type { UnitKnowledge } from '../domain/public/ground';
import type { GroundUnit, Platoon, WorldTruth } from '../domain/truth/world';
import { emptyPlayerKnowledge, type PlayerKnowledge } from '../knowledge/player-knowledge';
import { createRng, type RngState } from '../rng/streams';
import type { Scenario } from '../scenario/load';
import { createAircraft } from './air';
import { createPlatoon, createSquads } from './platoon';
import { createRadioState, type RadioState } from './radio';
import { generateWeather, skyOf } from './weather';
import { startRescue } from './rescue';
import { emptyLedger } from './wounded';

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
  const platoons: Record<string, Platoon> = {};
  const squads: GroundUnit[] = [];
  const files = [...scenario.file.units].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const file of files) {
    const created = createSquads(file, scenario);
    platoons[file.id] = createPlatoon(file, created, scenario);
    squads.push(...created);
  }
  const units = squads.sort((a, b) => (a.id < b.id ? -1 : 1));

  const state: SimState = {
    tick: 0,
    truth: {
      platoons,
      units,
      aircraft: createAircraft(scenario),
      tracks: {},
      nextContactNumber: 0,
      weather: generateWeather(file.weather, terrain.width * terrain.cellSize, file.durationSeconds, rng, skyOf(file)),
      flares: [],
      captureProgressSeconds: 0,
      locatedShare: null,
      friendlyFireCasualties: 0,
      casualties: { friendly: emptyLedger(), enemy: emptyLedger() },
      marks: [],
      outcome: 'running',
      endedAtTick: null,
    },
    unitKnowledge: {},
    radio: createRadioState(Object.values(platoons)),
    player: emptyPlayerKnowledge(),
    rng,
  };
  // A rescue starts with the survivor's supplies and the hunters' sighting of the parachute.
  startRescue(state.truth, state.unitKnowledge, scenario);
  return state;
}
