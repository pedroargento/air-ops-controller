import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import { runBattle } from '../../src/cli/battle';
import { policies } from '../../src/cli/policy-registry';
import type { AircraftId, AircraftOrder } from '../../src/domain/public/air';
import type { PlayerCommand } from '../../src/domain/public/commands';
import { distance } from '../../src/domain/public/geometry';
import type { Aircraft, Platoon } from '../../src/domain/truth/world';
import { createInitialState, type SimState } from '../../src/sim/state';
import { step } from '../../src/sim/step';

const scenario = loadScenarioFile('downed-pilot');
const mission = scenario.file.mission;
if (mission.kind !== 'Rescue') throw new Error('downed-pilot should be a rescue');
const { air } = scenario.file;
const SURVIVOR = mission.survivorId;
const JOLLY = 'JOLLY-1' as AircraftId;
const CAS = 'CAS-1' as AircraftId;

function run(state: SimState, ticks: number, commands: readonly PlayerCommand[] = []): void {
  step(state, commands, scenario);
  for (let i = 1; i < ticks && state.truth.outcome === 'running'; i += 1) step(state, [], scenario);
}

const survivor = (state: SimState): Platoon => state.truth.platoons[SURVIVOR]!;
const aircraft = (state: SimState, id: AircraftId): Aircraft => state.truth.aircraft.find((a) => a.id === id)!;
const order = (state: SimState, id: AircraftId, value: AircraftOrder): PlayerCommand => ({ kind: 'aircraftOrder', tick: state.tick, aircraftId: id, order: value });

/** A state with the hunters gone, so the survivor's fate is up to the controller. */
function alone(seed = 1): SimState {
  const state = createInitialState(scenario, seed);
  state.truth.units = state.truth.units.filter((unit) => unit.side !== 'enemy');
  return state;
}

/** Puts the helicopter ready on the field at once, instead of after it has been readied. */
function readyJolly(state: SimState): Aircraft {
  const jolly = aircraft(state, JOLLY);
  jolly.status = 'ready';
  jolly.timerSeconds = 0;
  return jolly;
}

describe('downed pilot', () => {
  it('starts with the survivor supplied and the hunters knowing where the parachute came down', () => {
    const state = createInitialState(scenario, 1);
    expect(survivor(state).survival).toMatchObject({ state: 'evading', battery: mission.batteryCalls, waterSeconds: mission.waterSeconds });
    for (const id of ['E-H1', 'E-H2']) expect(state.unitKnowledge[id]?.reports['SIGHTING']?.position.center).toEqual(mission.sightedAt);
  });

  it('keeps radio silence unless asked, and every answer costs battery and gives the hunters a fix', () => {
    const state = createInitialState(scenario, 1);
    run(state, 600);
    expect(state.player.log.some((message) => message.senderId === SURVIVOR)).toBe(false);
    run(state, 120, [{ kind: 'requestReport', tick: state.tick, unitId: SURVIVOR, report: 'sitrep' }]);
    const sitrep = state.player.log.find((message) => message.senderId === SURVIVOR && message.kind === 'SITREP');
    expect(sitrep?.kind === 'SITREP' ? sitrep.waterMinutes : undefined).toBeGreaterThan(0);
    expect(survivor(state).survival?.battery).toBe(mission.batteryCalls - 1);
    expect(state.unitKnowledge['E-H1']?.reports[`DF/${SURVIVOR}`]).toBeDefined();
    expect(state.player.statusReports[SURVIVOR]?.waterMinutes).toBeGreaterThan(0);
  });

  it('says nothing once the battery is flat', () => {
    const state = createInitialState(scenario, 1);
    survivor(state).survival!.battery = 0;
    run(state, 120, [{ kind: 'requestReport', tick: 0, unitId: SURVIVOR, report: 'position' }]);
    expect(state.player.log.some((message) => message.senderId === SURVIVOR)).toBe(false);
  });

  it('slows when the water runs out, then dies of thirst', () => {
    const state = alone();
    const survival = survivor(state).survival!;
    const speed = survivor(state).squads[0]!.doctrine.speedMps;
    survival.waterSeconds = 2;
    survival.thirstSeconds = 5;
    run(state, 3);
    expect(survivor(state).squads[0]!.doctrine.speedMps).toBeCloseTo(speed / 2);
    run(state, 10);
    expect(survival.state).toBe('dead');
    expect(state.truth.outcome).toBe('failure');
  });

  it('refuses a pickup to an aircraft with no seats', () => {
    const state = alone();
    run(state, 1, [order(state, CAS, { kind: 'Pickup', center: mission.sightedAt, radius: 50 })]);
    expect(aircraft(state, CAS).status).toBe('ready');
  });

  it('lands, waits for the survivor to board, flies home with it and wins', () => {
    const state = alone();
    readyJolly(state);
    const where = survivor(state).squads[0]!.position;
    run(state, 1, [order(state, JOLLY, { kind: 'Pickup', center: where, radius: 50 })]);
    const jolly = aircraft(state, JOLLY);
    for (let i = 0; i < 3000 && !jolly.landed; i += 1) step(state, [], scenario);
    expect(jolly.landed).toBe(true);
    expect(state.player.log.some((message) => message.kind === 'CREW_CALL' && message.call === 'WHEELS_DOWN')).toBe(true);
    run(state, air.boardSeconds - 2);
    expect(survivor(state).survival?.state).toBe('evading');
    for (let i = 0; i < 300 && survivor(state).survival?.state === 'evading'; i += 1) step(state, [], scenario);
    expect(survivor(state).survival?.state).toBe('aboard');
    expect(jolly.landed).toBe(false);
    expect(state.truth.units.some((unit) => unit.platoonId === SURVIVOR)).toBe(false);
    run(state, 4000);
    expect(state.truth.outcome).toBe('success');
    expect(jolly.record.survivorsDelivered).toBe(1);
    expect(jolly.record.sorties).toHaveLength(1);
    expect(jolly.record.sorties[0]?.returnedAt).not.toBeNull();
  });

  it('lifts off when told to, losing the boarding so far, and the survivor goes back to hiding', () => {
    const state = alone();
    readyJolly(state);
    const where = survivor(state).squads[0]!.position;
    run(state, 1, [order(state, JOLLY, { kind: 'Pickup', center: where, radius: 50 })]);
    const jolly = aircraft(state, JOLLY);
    for (let i = 0; i < 3000 && jolly.boardingSeconds < 5; i += 1) step(state, [], scenario);
    expect(jolly.boardingSeconds).toBeGreaterThanOrEqual(5);
    run(state, 1, [order(state, JOLLY, { kind: 'Watch', center: where, radius: 300 })]);
    expect(jolly.landed).toBe(false);
    expect(jolly.boardingSeconds).toBe(0);
    const objective = survivor(state).objective;
    expect(objective.kind === 'Evade' ? objective.boardAt : 'not evading').toBeNull();
    expect(survivor(state).survival?.state).toBe('evading');
  });

  it('is taken by hunters who have seen it and reach it', () => {
    const state = createInitialState(scenario, 1);
    const hunter = state.truth.units.find((unit) => unit.platoonId === 'E-H1')!;
    hunter.position = { ...survivor(state).squads[0]!.position };
    for (let i = 0; i < 120 && state.truth.outcome === 'running'; i += 1) step(state, [], scenario);
    expect(survivor(state).survival?.state).toBe('captured');
    expect(state.truth.outcome).toBe('failure');
  });

  it('is lost without air, and mostly brought home by an escorted rescue', () => {
    const outcomes = (name: string): string[] =>
      [0, 1, 2, 3].map((seed) => {
        let outcome = '';
        runBattle(scenario, seed, policies(scenario)[name]!(), (state) => {
          outcome = state.truth.outcome;
        });
        return outcome;
      });
    expect(outcomes('none').every((outcome) => outcome === 'failure')).toBe(true);
    expect(outcomes('rescueNow').filter((outcome) => outcome === 'success').length).toBeGreaterThanOrEqual(3);
    expect(distance(mission.sightedAt, mission.area.center)).toBeLessThan(mission.area.radius);
  });
});


describe('landed helicopter transitions', () => {
  function landed() {
    const state = alone();
    const jolly = readyJolly(state);
    jolly.position = { x: 0, y: 0 };
    jolly.status = 'onStation';
    jolly.landed = true;
    jolly.order = { kind: 'Pickup', center: jolly.position, radius: 50 };
    return { state, jolly };
  }

  it('lifts and travels when retasked directly to another pickup', () => {
    const { state, jolly } = landed();
    jolly.boardingSeconds = 12;
    jolly.loadProgress = 0.5;
    const target = { x: 1000, y: 1000 };
    run(state, 10, [order(state, JOLLY, { kind: 'Pickup', center: target, radius: 50 })]);
    expect(jolly.landed).toBe(false);
    expect(distance(jolly.position, { x: 0, y: 0 })).toBeGreaterThan(0);
    expect(jolly.boardingSeconds).toBe(0);
    expect(jolly.loadProgress).toBe(0);
  });

  it('leaves a pickup at BINGO with wounded already aboard', () => {
    const { state, jolly } = landed();
    const model = air.models[jolly.model]!;
    jolly.fuelSeconds = distance(jolly.position, air.airbase) / model.speedMps + model.bingoMarginSeconds;
    jolly.casualtiesAboard = [{ count: 1, since: 0 }];
    run(state, 1);
    expect(jolly.status).toBe('returning');
    expect(jolly.landed).toBe(false);
    expect(jolly.order).toBeNull();
    expect(jolly.casualtiesAboard).toEqual([{ count: 1, since: 0 }]);
    expect(jolly.fuelSeconds).toBeGreaterThan(0);
  });
});
