import { emptyFire } from '../../src/domain/public/fire';
import { describe, expect, it } from 'vitest';
import { decidePlatoon } from '../../src/ai/decide-ground';
import { runBattle } from '../../src/cli/battle';
import { loadScenarioFile, scenarioNames } from '../../src/cli/load-scenario';
import { policies } from '../../src/cli/policy-registry';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import { distance } from '../../src/domain/public/geometry';
import type { Poi } from '../../src/domain/public/poi';
import { emptyPlayerKnowledge } from '../../src/knowledge/player-knowledge';
import { project } from '../../src/knowledge/player-view';
import { markingKillZones, noAir, sweepingRecon, type Policy } from '../../src/policies/air-policies';
import { locatedShare } from '../../src/sim/outcome';
import { createInitialState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import type { UnitSelf } from '../../src/domain/public/ground';

const valley = loadScenarioFile('valley-road');
const findThem = loadScenarioFile('find-them');

const poi: Poi = { id: 'P-1', kind: 'killZone', center: { x: 500, y: 0 }, radiusMeters: 150, placedAt: 0, recipients: ['P'] };

describe('reporting a point of interest', () => {
  const issue = (recipients: readonly string[]) => {
    const state = createInitialState(valley, 1);
    const command = { kind: 'reportPoi', tick: 0, poiKind: 'killZone', center: { x: 1775, y: 2325 }, radiusMeters: 150, recipients } as const;
    step(state, [command], valley);
    return state;
  };

  it('stays on the map and reaches the unit after a radio delay', () => {
    const state = issue(['F-C1']);
    expect(state.player.pois).toHaveLength(1);
    expect(Object.keys(state.unitKnowledge['F-C1']?.pois ?? {})).toHaveLength(0);
    for (let i = 0; i < valley.file.radio.transmitSeconds + 1; i += 1) step(state, [], valley);
    expect(Object.keys(state.unitKnowledge['F-C1']?.pois ?? {})).toHaveLength(1);
  });

  it('cannot go to a unit that has no link to air operations', () => {
    expect(issue(['E-A1']).player.pois).toHaveLength(0);
  });

  it('cancels, on the map and then at the unit', () => {
    const state = issue(['F-C1']);
    for (let i = 0; i < 20; i += 1) step(state, [], valley);
    const id = state.player.pois[0]?.id ?? '';
    step(state, [{ kind: 'cancelPoi', tick: state.tick, poiId: id }], valley);
    expect(state.player.pois).toHaveLength(0);
    for (let i = 0; i < 20; i += 1) step(state, [], valley);
    expect(state.unitKnowledge['F-C1']?.pois[id]).toBeUndefined();
  });

  it('replays exactly, as part of the command log', () => {
    const run = (): unknown => {
      const state = issue(['F-C1']);
      for (let i = 0; i < 50; i += 1) step(state, [], valley);
      return state.player.log.length;
    };
    expect(run()).toBe(run());
  });

  it('shows in the view from what the player knows', () => {
    const player = emptyPlayerKnowledge();
    player.pois.push(poi);
    expect(project(player, [], 10, valley.file.display).pois).toEqual([poi]);
  });

  it('makes a platoon treat the mark as an enemy position on its route', () => {
    const column = valley.doctrines['column'];
    if (column === undefined) throw new Error('No column doctrine');
    const self = {
      id: 'P', side: 'friendly', position: { x: 0, y: 0 }, slot: { x: 0, y: 0 }, platoonPersonnel: 24, wounded: 0, platoonWounded: 0, platoonFree: 24, platoonInitialPersonnel: 24, woundedWaitSeconds: null, squads: 2, drill: null, role: null,
      viaDone: false, ambushSprung: false, handled: [], routeAhead: [100, 200, 300, 400, 500, 600, 700].map((x) => ({ x, y: 0 })), secondsLeft: 7200, canCallAir: false,
      ownPosition: { center: { x: 0, y: 0 }, sigmaMeters: 40, headingRad: null, speedMps: null, observedAt: 0 }, personnel: 24, initialPersonnel: 24,
      ammunition: 1000, initialAmmunition: 1000, equipment: [], supportWeapons: 1, airWeapons: [], morale: 0.8, suppression: 0, underFire: false,
      mode: 'steady', behavior: null, behaviorSinceTick: 0, groundCover: 0, returnsUsed: 0, patrolIndex: 0,
      objective: { kind: 'MoveTo', area: { center: { x: 3000, y: 0 }, radius: 100 } }, fallback: { center: { x: -500, y: 0 }, radius: 100 }, doctrine: column,
    } as unknown as UnitSelf;
    const map = { routeMeters: distance, sees: () => false, cover: () => 0 };
    const knowledge = { contacts: {}, reports: {}, pois: { 'P-1': poi }, suppressions: {}, expectedSupport: null, supportRefusedAt: null, medevacAnsweredAt: null, hostileAircraftSeenAt: null, noticedAircraft: null, fire: emptyFire() };
    expect(decidePlatoon(self, knowledge, 100, map).drill?.target).toEqual(poi.center);
    expect(decidePlatoon(self, { ...knowledge, pois: {} }, 100, map).drill).toBeNull();
  });

  it('pushes through a marked position while air operations says it is being suppressed', () => {
    const column = valley.doctrines['column'];
    if (column === undefined) throw new Error('No column doctrine');
    const self = {
      id: 'P', side: 'friendly', position: { x: 0, y: 0 }, slot: { x: 0, y: 0 }, platoonPersonnel: 24, wounded: 0, platoonWounded: 0, platoonFree: 24, platoonInitialPersonnel: 24, woundedWaitSeconds: null, squads: 2, drill: null, role: null,
      viaDone: false, ambushSprung: false, handled: [], routeAhead: [100, 200, 300, 400, 500, 600, 700].map((x) => ({ x, y: 0 })), secondsLeft: 7200, canCallAir: false,
      ownPosition: { center: { x: 0, y: 0 }, sigmaMeters: 40, headingRad: null, speedMps: null, observedAt: 0 }, personnel: 24, initialPersonnel: 24,
      ammunition: 1000, initialAmmunition: 1000, equipment: [], supportWeapons: 1, airWeapons: [], morale: 0.8, suppression: 0, underFire: false,
      mode: 'steady', behavior: null, behaviorSinceTick: 0, groundCover: 0, returnsUsed: 0, patrolIndex: 0,
      objective: { kind: 'MoveTo', area: { center: { x: 3000, y: 0 }, radius: 100 } }, fallback: { center: { x: -500, y: 0 }, radius: 100 }, doctrine: column,
    } as unknown as UnitSelf;
    const map = { routeMeters: distance, sees: () => false, cover: () => 0 };
    const suppression = { aircraftId: 'CAS-1', center: { x: 520, y: 30 }, radius: 150, fromTick: 50, untilTick: 900 };
    const knowledge = { contacts: {}, reports: {}, pois: { 'P-1': poi }, suppressions: { 'CAS-1': suppression }, expectedSupport: null, supportRefusedAt: null, medevacAnsweredAt: null, hostileAircraftSeenAt: null, noticedAircraft: null, fire: emptyFire() };
    expect(decidePlatoon(self, knowledge, 100, map).drill?.kind).toBe('pushThrough');
    // Before it starts, after it ends, or somewhere else, the platoon answers the position as usual.
    expect(decidePlatoon(self, knowledge, 40, map).drill?.kind).not.toBe('pushThrough');
    expect(decidePlatoon(self, knowledge, 901, map).drill?.kind).not.toBe('pushThrough');
    const elsewhere = { 'CAS-1': { ...suppression, center: { x: 2000, y: 2000 } } };
    expect(decidePlatoon(self, { ...knowledge, suppressions: elsewhere }, 100, map).drill?.kind).not.toBe('pushThrough');
  });
});

describe('facing', () => {
  it('points an ambush at the ground it watches', () => {
    const state = createInitialState(valley, 1);
    for (let i = 0; i < 50; i += 1) step(state, [], valley);
    const squad = state.truth.platoons['E-A1']?.squads[0];
    if (squad === undefined) throw new Error('No squad');
    expect(Math.cos(squad.facingRad)).toBeLessThan(-0.9);
  });

  it('sometimes reaches a crew, and a marking player can read it', () => {
    const contact = (x: number, facingRad: number): ContactEstimate => ({
      contactId: `C-${x}` as ContactEstimate['contactId'],
      provenance: { sourceId: 'RECON-1', observedAt: 0 },
      identification: 'hostile',
      position: { center: { x, y: 0 }, sigmaMeters: 30, headingRad: null, speedMps: null, observedAt: 0 },
      strength: { kind: 'range', min: 6, max: 14 },
      kind: 'infantry',
      activity: 'stationary',
      confidence: 'medium',
      observedWeapons: [],
      facingRad,
    });
    const player = emptyPlayerKnowledge();
    for (const entry of [contact(1000, Math.PI), contact(1050, Math.PI)]) {
      player.contacts[entry.contactId] = { contact: entry, viaAircraft: true, status: 'active', statusAt: 0, clearLookSeconds: 0, estimatedLosses: 0 } as never;
    }
    const view = { ...project(player, [], 10, valley.file.display), friendlies: [{ unitId: 'F-C1' }] } as never;
    const passive: Policy = () => [];
    const [command] = markingKillZones(passive)(view);
    if (command?.kind !== 'reportPoi') throw new Error('Expected a mark');
    expect(command.center.x).toBeCloseTo(875);
  });

  it('marks nothing on one lone squad', () => {
    const passive: Policy = () => [];
    expect(markingKillZones(passive)(project(emptyPlayerKnowledge(), [], 10, valley.file.display))).toEqual([]);
  });
});

describe('Find Them', () => {
  it('is listed as a scenario', () => {
    expect(scenarioNames()).toContain('find-them');
  });

  it('scores by the player\'s picture, not by what happened', () => {
    const { truth, player } = createInitialState(findThem, 1);
    if (findThem.file.mission.kind !== 'LocateForce') throw new Error('Expected a search');
    expect(locatedShare(truth, player, findThem.file.mission, 0)).toBe(0);
  });

  it('rewards a search over no search', () => {
    const size = findThem.terrain.width * findThem.terrain.cellSize;
    const quarter = size / 4;
    const sectors = [
      { x: quarter, y: quarter },
      { x: 3 * quarter, y: quarter },
      { x: 3 * quarter, y: 3 * quarter },
      { x: quarter, y: 3 * quarter },
    ];
    expect(runBattle(findThem, 1, noAir).outcome).toBe('failure');
    const searched = [1, 2, 3, 4, 5].map((seed) => runBattle(findThem, seed, sweepingRecon(sectors, 1200, 420)).outcome);
    expect(searched.filter((outcome) => outcome === 'success').length).toBeGreaterThanOrEqual(3);
  });

  it('has its own policies', () => {
    expect(Object.keys(policies(findThem))).toEqual(['none', 'oneOrbit', 'oneOrbitApprove', 'sweep', 'sweepApprove']);
  });
});
