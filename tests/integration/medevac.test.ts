import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import { chooseLandingZone } from '../../src/ai/medevac';
import type { AircraftId } from '../../src/domain/public/air';
import type { PlayerCommand } from '../../src/domain/public/commands';
import { distance } from '../../src/domain/public/geometry';
import { emptyKnowledge, type UnitSelf } from '../../src/domain/public/ground';
import type { Aircraft, GroundUnit } from '../../src/domain/truth/world';
import { createInitialState, type SimState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { carers, fightingMen, takeCasualties, takeWounded, updateWounds, woundedCount, woundedSpeedFactor } from '../../src/sim/wounded';

const scenario = loadScenarioFile('outpost-under-pressure');
const { combat, air, radio } = scenario.file;
const DUSTOFF = 'DUSTOFF-1' as AircraftId;
const GARRISON = 'F-A';

function run(state: SimState, ticks: number, commands: readonly PlayerCommand[] = []): void {
  step(state, commands, scenario);
  for (let i = 1; i < ticks && state.truth.outcome === 'running'; i += 1) step(state, [], scenario);
}

const squad = (state: SimState, id: string): GroundUnit => state.truth.units.find((unit) => unit.id === id)!;
const dustoff = (state: SimState): Aircraft => state.truth.aircraft.find((a) => a.id === DUSTOFF)!;

/** The outpost with no enemy, and a garrison squad carrying wounded since the start. */
function quiet(wounded: number, seed = 1): SimState {
  const state = createInitialState(scenario, seed);
  state.truth.units = state.truth.units.filter((unit) => unit.side !== 'enemy');
  const first = squad(state, `${GARRISON}/1`);
  if (wounded > 0) first.wounded.push({ count: wounded, since: 0 });
  state.truth.casualties.friendly.wounded += wounded;
  return state;
}

describe('wounded (§4.1.1)', () => {
  it('splits casualties into killed and wounded by the rules share', () => {
    const state = quiet(0);
    const unit = squad(state, `${GARRISON}/1`);
    takeCasualties(state.truth, unit, 6, { ...combat, woundedShare: 1 }, state.rng, 0);
    takeCasualties(state.truth, unit, 4, { ...combat, woundedShare: 0 }, state.rng, 0);
    expect(woundedCount(unit.wounded)).toBe(6);
    expect(state.truth.casualties.friendly).toMatchObject({ wounded: 6, killed: 4 });
  });

  it('ties down carers, who neither fire nor walk as fast', () => {
    const state = quiet(4);
    const unit = squad(state, `${GARRISON}/1`);
    const config = { ...combat, carersPerWounded: 0.5, woundedSlow: 0.5 };
    expect(carers(unit, config)).toBe(2);
    expect(fightingMen(unit, config)).toBe(unit.personnel - 2);
    expect(woundedSpeedFactor(unit, config)).toBeCloseTo(1 - 0.5 * (4 / unit.personnel));
    expect(woundedSpeedFactor(unit, { ...config, woundedSlow: 0 })).toBe(1);
  });

  it('lets the wounded die faster the longer they wait', () => {
    const config = { ...combat, woundDeathPerHour: 0.5, woundWorsenSeconds: 600 };
    const deaths = (since: number): number => {
      let total = 0;
      for (let seed = 1; seed <= 40; seed += 1) {
        const state = quiet(0, seed);
        squad(state, `${GARRISON}/1`).wounded.push({ count: 200, since });
        updateWounds(state.truth, config, state.rng, 3600);
        total += state.truth.casualties.friendly.diedOfWounds;
      }
      return total;
    };
    expect(deaths(0)).toBeGreaterThan(deaths(3600) * 2);
  });

  it('loses the wounded of a squad with no fit men left, as killed', () => {
    const state = quiet(3);
    const unit = squad(state, `${GARRISON}/1`);
    unit.personnel = 0;
    updateWounds(state.truth, combat, state.rng, 5);
    expect(unit.wounded).toEqual([]);
    expect(state.truth.casualties.friendly).toMatchObject({ killed: 3, wounded: 0 });
  });

  it('hands over the longest-waiting wounded first', () => {
    const state = quiet(0);
    const unit = squad(state, `${GARRISON}/1`);
    unit.wounded.push({ count: 2, since: 300 }, { count: 2, since: 100 });
    expect(takeWounded(unit, 3)).toEqual([{ count: 2, since: 100 }, { count: 1, since: 300 }]);
    expect(unit.wounded).toEqual([{ count: 1, since: 300 }]);
  });
});

describe('medevac (§8.9)', () => {
  it('asks for medevac with the number of wounded and a pickup point near the platoon', () => {
    const state = quiet(radio.medevacMinWounded);
    run(state, 120);
    const request = state.player.medevacRequests[GARRISON];
    expect(request?.wounded).toBe(radio.medevacMinWounded);
    expect(request?.hot).toBe(false);
    const garrison = squad(state, `${GARRISON}/1`);
    expect(distance(request!.pickup, garrison.position)).toBeLessThan(radio.lzSearchMeters + 100);
  });

  it('keeps quiet below the least number of wounded worth a helicopter', () => {
    const state = quiet(radio.medevacMinWounded - 1);
    run(state, 300);
    expect(state.player.medevacRequests[GARRISON]).toBeUndefined();
  });

  it('picks a pickup point the enemy it knows of cannot see, as far from it as it can', () => {
    const self = { position: { x: 0, y: 0 }, ownPosition: { center: { x: 0, y: 0 } }, underFire: false } as unknown as UnitSelf;
    const knowledge = emptyKnowledge();
    knowledge.contacts['C'] = {
      contactId: 'C', provenance: { sourceId: 'X', observedAt: 0 }, identification: 'hostile', kind: 'infantry', activity: 'unknown', confidence: 'high', observedWeapons: [],
      position: { center: { x: 400, y: 0 }, sigmaMeters: 20, headingRad: null, speedMps: null, observedAt: 0 }, strength: { kind: 'range', min: 5, max: 10 },
    } as unknown as (typeof knowledge.contacts)[string];
    // Everything east of the platoon is in the enemy's view.
    const zone = chooseLandingZone(self, knowledge, (_, to) => to.x >= 0, 150, 300);
    expect(zone.pickup.x).toBeLessThan(0);
    expect(zone.pickup.x).toBeCloseTo(-150, 6);
    expect(zone.pickup.y).toBeCloseTo(0, 6);
    expect(zone.hot).toBe(false);
  });

  it('sends a helicopter with seats to the pickup point, and refuses one without', () => {
    const state = quiet(4);
    run(state, 120);
    const pickup = state.player.medevacRequests[GARRISON]!.pickup;
    run(state, 1, [{ kind: 'answerMedevac', tick: state.tick, unitId: GARRISON, helicopterId: 'CAS-1' as AircraftId }]);
    expect(state.player.medevacRequests[GARRISON]?.answer).toBeNull();
    run(state, 1, [{ kind: 'answerMedevac', tick: state.tick, unitId: GARRISON, helicopterId: DUSTOFF }]);
    expect(dustoff(state).order).toMatchObject({ kind: 'Pickup', center: pickup });
    expect(state.player.medevacRequests[GARRISON]?.answer).toMatchObject({ kind: 'sent', aircraftId: DUSTOFF });
    run(state, radio.transmitSeconds + 2);
    expect(state.unitKnowledge[GARRISON]?.medevacAnsweredAt).not.toBeNull();
  });

  it('loads wounded at the rules rate, flies them to hospital and records the time', () => {
    const state = quiet(4);
    const helicopter = dustoff(state);
    const garrison = squad(state, `${GARRISON}/1`);
    helicopter.status = 'onStation';
    helicopter.position = { ...garrison.position };
    helicopter.order = { kind: 'Pickup', center: garrison.position, radius: 100 };
    run(state, 2);
    expect(helicopter.landed).toBe(true);
    const perWounded = 60 / air.loadPerMinute;
    run(state, Math.ceil(perWounded * 2));
    expect(woundedCount(helicopter.casualtiesAboard)).toBeGreaterThanOrEqual(2);
    run(state, Math.ceil(perWounded * 3));
    // All four aboard: none left within reach, so the crew heads for the hospital.
    expect(woundedCount(helicopter.casualtiesAboard)).toBe(4);
    expect(helicopter.landed).toBe(false);
    expect(helicopter.order).toEqual({ kind: 'ReturnToBase' });
    expect(state.player.log.some((message) => message.kind === 'CREW_CALL' && message.call === 'WOUNDED_ABOARD')).toBe(true);
    run(state, 1200);
    const ledger = state.truth.casualties.friendly;
    expect(ledger.evacuated).toBe(4);
    expect(ledger.hospitalSeconds / 4).toBeGreaterThan(perWounded * 4);
    expect(helicopter.casualtiesAboard).toEqual([]);
  });

  it('stops at the seats', () => {
    const state = quiet(10);
    const helicopter = dustoff(state);
    const garrison = squad(state, `${GARRISON}/1`);
    helicopter.status = 'onStation';
    helicopter.position = { ...garrison.position };
    helicopter.order = { kind: 'Pickup', center: garrison.position, radius: 100 };
    run(state, 200);
    const seats = air.models['UH-1H']!.seats;
    expect(woundedCount(helicopter.casualtiesAboard)).toBe(seats);
    expect(woundedCount(garrison.wounded)).toBe(10 - seats);
  });

  it('keeps the wounded aboard when it lifts off on a new order', () => {
    const state = quiet(4);
    const helicopter = dustoff(state);
    const garrison = squad(state, `${GARRISON}/1`);
    helicopter.status = 'onStation';
    helicopter.position = { ...garrison.position };
    helicopter.order = { kind: 'Pickup', center: garrison.position, radius: 100 };
    run(state, 25);
    const aboard = woundedCount(helicopter.casualtiesAboard);
    expect(aboard).toBeGreaterThan(0);
    run(state, 1, [{ kind: 'aircraftOrder', tick: state.tick, aircraftId: DUSTOFF, order: { kind: 'ReturnToBase' } }]);
    expect(helicopter.landed).toBe(false);
    expect(woundedCount(helicopter.casualtiesAboard)).toBe(aboard);
  });
});
