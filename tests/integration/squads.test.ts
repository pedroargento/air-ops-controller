import { describe, expect, it } from 'vitest';
import { groupedContact, groupLeads, groupStrength } from '../../src/ai/contact-groups';
import { decideReports, initialRadioMemory } from '../../src/ai/report';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import { totalAmmunition } from '../../src/domain/public/equipment';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import { emptyKnowledge, type ContactId, type UnitKnowledge, type UnitSelf } from '../../src/domain/public/ground';
import type { TerrainGrid } from '../../src/domain/public/terrain';
import { createRng } from '../../src/rng/streams';
import { resolveCas } from '../../src/sim/air';
import { applyEffects, resolveCombat } from '../../src/sim/combat';
import { platoonPersonnel, shareOut } from '../../src/sim/platoon';
import { createRadioState } from '../../src/sim/radio';
import { createInitialState } from '../../src/sim/state';
import { step } from '../../src/sim/step';

const scenario = loadScenarioFile();
const { combat } = scenario.file;

/** A high wall across the middle of a stretch of open ground. */
function withWall(terrain: TerrainGrid): TerrainGrid {
  const elevation = new Float32Array(terrain.elevation.length);
  for (let row = 0; row < terrain.height; row += 1) elevation[row * terrain.width + 3] = 500;
  return { ...terrain, elevation };
}

const contact = (id: string, x: number, min = 6, max = 14): ContactEstimate => ({
  contactId: id as ContactId,
  provenance: { sourceId: 'F-A', observedAt: 0 },
  identification: 'hostile',
  position: { center: { x, y: 0 }, sigmaMeters: 30, headingRad: null, speedMps: null, observedAt: 0 },
  strength: { kind: 'range', min, max },
  kind: 'infantry',
  activity: 'moving',
  confidence: 'medium',
  observedWeapons: [],
});

const knowing = (...contacts: readonly ContactEstimate[]): UnitKnowledge => ({
  ...emptyKnowledge(),
  contacts: Object.fromEntries(contacts.map((entry) => [entry.contactId, entry])),
});

describe('dividing platoons', () => {
  it('shares out exactly, with any spare going to the first squads', () => {
    expect(shareOut(40, 3)).toEqual([14, 13, 13]);
    expect(shareOut(1, 3)).toEqual([1, 0, 0]);
  });

  it('keeps every person, weapon and round of the scenario file', () => {
    const { truth } = createInitialState(scenario, 1);
    for (const file of scenario.file.units) {
      const platoon = truth.platoons[file.id];
      if (platoon === undefined) throw new Error(`No platoon ${file.id}`);
      expect(platoonPersonnel(platoon)).toBe(file.personnel);
      const carried = platoon.squads.reduce((sum, unit) => sum + totalAmmunition(unit.equipment), 0);
      expect(carried).toBeCloseTo(totalAmmunition(file.equipment));
      for (const { weapon, quantity } of file.equipment) {
        const held = platoon.squads.flatMap((unit) => unit.equipment).filter((item) => item.weapon === weapon);
        expect(held.reduce((sum, item) => sum + item.quantity, 0)).toBe(quantity);
      }
    }
  });

  it('never stacks a platoon on one spot', () => {
    const { truth } = createInitialState(scenario, 1);
    for (const platoon of Object.values(truth.platoons)) {
      const spots = new Set(platoon.squads.map(({ position }) => `${position.x},${position.y}`));
      expect(spots.size).toBe(platoon.squads.length);
    }
  });

  it('forms about the planned number of squads', () => {
    const { truth } = createInitialState(scenario, 1);
    expect(truth.units.length).toBeGreaterThanOrEqual(30);
    expect(truth.units.length).toBeLessThanOrEqual(40);
    expect(truth.platoons['E-W']?.squads.length).toBe(6);
  });
});

describe('a platoon acts as one', () => {
  it('has a single picture: what one squad sees, all know', () => {
    const state = createInitialState(scenario, 1);
    while (state.tick < 2700) step(state, [], scenario);
    expect(Object.keys(state.unitKnowledge).sort()).toEqual(Object.keys(state.truth.platoons).sort());
  });

  it('withdraws together on the platoon\'s totals, whichever squad took the losses', () => {
    const state = createInitialState(scenario, 1);
    const platoon = state.truth.platoons['E-N2'];
    const [first, ...rest] = platoon?.squads ?? [];
    if (platoon === undefined || first === undefined) throw new Error('Expected squads');
    first.personnel = 0;
    first.equipment = first.equipment.map((item) => ({ ...item, quantity: 0 }));
    step(state, [], scenario);
    expect(platoon.mode).toBe('steady');
    for (const squad of rest) squad.personnel = Math.floor(squad.personnel * 0.3);
    step(state, [], scenario);
    while (state.tick % 5 !== 1) step(state, [], scenario);
    expect(platoon.mode).toBe('withdrawing');
    expect(rest.every((squad) => squad.intent.kind === 'move' || squad.intent.kind === 'engage')).toBe(true);
  });

  it('counts casualties against the platoon, once', () => {
    const { truth } = createInitialState(scenario, 1);
    const platoon = truth.platoons['E-N2'];
    const [first, second] = platoon?.squads ?? [];
    if (platoon === undefined || first === undefined || second === undefined) throw new Error('Expected squads');
    const start = platoon.morale;
    const effect = (id: string) => ({ targetId: id, casualties: 3, suppression: 0, morale: 0 });
    applyEffects(truth, [effect(first.id), effect(second.id)], combat, createRng(1), 10);
    expect(platoon.morale).toBeCloseTo(start - (combat.moraleLossPerCasualtyFraction * 6) / platoon.initialPersonnel);
  });

  it('talks to Air Ops under the platoon ID, with one radio per platoon', () => {
    const { truth } = createInitialState(scenario, 1);
    const radio = createRadioState(Object.values(truth.platoons));
    expect(Object.keys(radio.units).sort()).toEqual(scenario.file.units.map((unit) => unit.id).sort());
  });
});

describe('fire and strikes on squads', () => {
  const strike = (gap: number, seed: number) => {
    const state = createInitialState(heavy, seed);
    const platoon = state.truth.platoons['E-N2'];
    const [target, neighbour] = platoon?.squads ?? [];
    const plane = state.truth.aircraft.find((a) => a.id === 'CAS-1');
    if (platoon === undefined || target === undefined || neighbour === undefined || plane === undefined) {
      throw new Error('Expected a platoon and an aircraft');
    }
    target.position = { x: 2525, y: 1700 };
    neighbour.position = { x: 2525 + gap, y: 1700 };
    state.truth.units = [target, neighbour];
    return { state, plane, target, neighbour };
  };
  const heavy = {
    ...scenario,
    file: {
      ...scenario.file,
      air: {
        ...scenario.file.air,
        models: {
          ...scenario.file.air.models,
          'A-1E': { ...scenario.file.air.models['A-1E']!, casualtyFractionPerPass: 1, strikeMissPerMeterAltitude: 0 },
        },
      },
    },
  };

  it('catches a squad beside the target, and not one far from it', () => {
    let close = 0;
    let far = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      for (const [gap, count] of [[30, 'close'], [400, 'far']] as const) {
        const { state, plane, target, neighbour } = strike(gap, seed);
        const start = neighbour.personnel;
        plane.status = 'onStation';
        plane.position = target.position;
        plane.altitudeMeters = 300;
        plane.order = { kind: 'SupportArea', center: target.position, radius: 200 };
        const contactId = 'C-1' as ContactId;
        plane.contacts[contactId] = { ...contact('C-1', 2525), position: { ...contact('C-1', 2525).position, center: target.position } };
        state.truth.tracks[plane.id] = {
          [target.id]: {
            contactId,
            anchor: target.position,
            errorOffset: { x: 0, y: 0 },
            lastActivity: 'moving',
            lastSeenPosition: target.position,
            lastSeenTick: 0,
            estimate: contact('C-1', 2525),
          },
        };
        resolveCas(state.truth, state.player, state.radio, scenario.terrain, heavy.file.air, combat, scenario.file.display, 120, state.rng, 0);
        if (count === 'close') close += start - neighbour.personnel;
        else far += start - neighbour.personnel;
      }
    }
    expect(close).toBeGreaterThan(0);
    expect(far).toBe(0);
  });

  it('a squad with no line of sight does not fire on what its platoon sees', () => {
    const ridge = (blocked: boolean): number => {
      const { truth } = createInitialState(scenario, 1);
      const [firer] = truth.platoons['F-A']?.squads ?? [];
      const [target] = truth.platoons['E-N1']?.squads ?? [];
      if (firer === undefined || target === undefined) throw new Error('Expected squads');
      firer.position = { x: 100, y: 100 };
      target.position = { x: 200, y: 100 };
      truth.units = [firer, target];
      truth.tracks[firer.platoonId] = {
        [target.id]: {
          contactId: 'C-1' as ContactId,
          anchor: target.position,
          errorOffset: { x: 0, y: 0 },
          lastActivity: 'moving',
          lastSeenPosition: target.position,
          lastSeenTick: 0,
          estimate: contact('C-1', 200),
        },
      };
      firer.intent = { kind: 'engage', contactId: 'C-1' as ContactId, closeTo: null, fireRate: 1, prepared: false };
      const terrain = blocked ? withWall(scenario.terrain) : scenario.terrain;
      resolveCombat(truth, {}, terrain, combat, createRng(1), 0);
      return totalAmmunition(firer.equipment);
    };
    const start = createInitialState(scenario, 1).truth.platoons['F-A']?.squads[0]?.initialAmmunition;
    expect(ridge(true)).toBe(start);
    expect(ridge(false)).toBeLessThan(start as number);
  });
});

describe('contact groups', () => {
  const near = knowing(contact('C-1', 0), contact('C-2', 80), contact('C-3', 150));

  it('adds up contacts close together', () => {
    expect(groupStrength(near, contact('C-1', 0))).toBe(30);
    expect(groupedContact(near, contact('C-1', 0)).strength).toEqual({ kind: 'range', min: 15, max: 50 });
  });

  it('keeps contacts far apart separate', () => {
    const far = knowing(contact('C-1', 0), contact('C-2', 900));
    expect(groupStrength(far, contact('C-1', 0))).toBe(10);
    expect(groupLeads(far)).toHaveLength(2);
  });

  it('returns a lone contact unchanged', () => {
    const lone = contact('C-1', 0);
    expect(groupedContact(knowing(lone), lone)).toEqual(lone);
  });

  it('makes one contact report for a group of squads', () => {
    const self = { position: { x: 0, y: 0 }, personnel: 30, initialPersonnel: 30 } as UnitSelf;
    const { needs } = decideReports(
      { ...self, underFire: false },
      near,
      initialRadioMemory(30),
      scenario.file.radio,
      true,
      0,
    );
    const reports = needs.filter((need) => need.kind === 'CONTACT_REPORT');
    expect(reports).toHaveLength(1);
    expect(reports[0]?.captured?.strength).toEqual({ kind: 'range', min: 15, max: 50 });
  });
});
