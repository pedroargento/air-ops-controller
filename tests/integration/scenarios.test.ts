import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/cli/battle';
import { DEFAULT_SCENARIO_NAME, loadScenarioFile, readScenarioFile, readTerrainLayer, scenarioNames } from '../../src/cli/load-scenario';
import { policies } from '../../src/cli/policy-registry';
import { firstDivergence, runReplay } from '../../src/cli/replay';
import { buildLayers, TERRAIN_RECIPES } from '../../src/cli/terrain-recipes';
import { loadBundledScenario, scenarioNames as bundledNames } from '../../src/scenario/catalog';
import { loadScenario } from '../../src/scenario/load';
import { applyRules } from '../../src/scenario/rules';
import { createInitialState } from '../../src/sim/state';
import { updateOutcome } from '../../src/sim/outcome';
import { singleSquads } from '../support/single-squads';

const valley = loadScenarioFile('valley-road');

describe('scenario files', () => {
  it('finds every scenario, and each one loads', () => {
    expect(scenarioNames()).toContain(DEFAULT_SCENARIO_NAME);
    expect(scenarioNames()).toContain('valley-road');
    for (const name of scenarioNames()) expect(loadScenarioFile(name).file.id).toBe(name);
  });

  it('names what exists when a scenario is unknown', () => {
    expect(() => loadScenarioFile('nowhere')).toThrow(/Unknown scenario "nowhere".*valley-road/);
    expect(() => loadBundledScenario('nowhere')).toThrow(/Unknown scenario "nowhere".*valley-road/);
  });

  it('gives the browser the same scenarios as the command line', () => {
    expect(bundledNames()).toEqual(scenarioNames());
    for (const name of scenarioNames()) expect(loadBundledScenario(name).file).toEqual(loadScenarioFile(name).file);
  });

  it('generates each scenario terrain exactly as stored', () => {
    for (const [name, recipe] of Object.entries(TERRAIN_RECIPES)) {
      const { classLayer, elevationLayer } = buildLayers(recipe);
      expect(classLayer).toBe(readTerrainLayer(`${name}/terrain.txt`));
      expect(elevationLayer).toBe(readTerrainLayer(`${name}/elevation.txt`));
    }
  });

  it('shares rules, and lets a scenario replace one value', () => {
    const rules = { weather: { rainMissMeters: 80, cloudFadeMeters: 200 }, radio: { engagedRate: 1 } };
    const merged = applyRules({ id: 'x', weather: { rainMissMeters: 10 } }, rules);
    expect(merged).toEqual({ id: 'x', weather: { rainMissMeters: 10, cloudFadeMeters: 200 }, radio: { engagedRate: 1 } });
  });

  it('rejects a mission that names a unit it cannot use', () => {
    const raw = readScenarioFile('valley-road');
    const mission = raw['mission'] as Record<string, unknown>;
    const load = (unitIds: string[]) =>
      loadScenario(
        { ...raw, mission: { ...mission, unitIds } },
        readTerrainLayer(raw.terrain.classLayer),
        readTerrainLayer(raw.terrain.elevationLayer),
      );
    expect(() => load(['NOBODY'])).toThrow(/unknown unit/);
    expect(() => load(['E-A1'])).toThrow(/not friendly/);
  });

  it('never mentions an enemy unit in what the player reads', () => {
    for (const name of scenarioNames()) {
      const { file } = loadScenarioFile(name);
      const text = JSON.stringify([file.mission.briefing, file.mission.areaLabel, file.mission.results]);
      for (const unit of file.units) if (unit.side === 'enemy') expect(text).not.toContain(unit.name);
    }
  });
});

describe('reach-area missions', () => {
  const { mission, durationSeconds } = valley.file;
  if (mission.kind !== 'ReachArea') throw new Error('Valley Road is a reach mission');
  const setup = () => {
    const { truth } = createInitialState(singleSquads(valley), 1);
    const column = truth.units.filter((u) => mission.unitIds.includes(u.platoonId));
    return { truth, column };
  };

  it('keeps running until every survivor has arrived', () => {
    const { truth, column } = setup();
    const [lead] = column;
    if (lead !== undefined) lead.position = mission.area.center;
    updateOutcome(truth, mission, durationSeconds, 100);
    expect(truth.outcome).toBe('running');
  });

  it('succeeds when enough of the column arrives', () => {
    const { truth, column } = setup();
    for (const unit of column) unit.position = mission.area.center;
    updateOutcome(truth, mission, durationSeconds, 100);
    expect(truth.outcome).toBe('success');
    expect(truth.endedAtTick).toBe(100);
  });

  it('counts heavy losses as partial, and doesn\'t wait for the dead', () => {
    const { truth, column } = setup();
    const [lead, rear] = column;
    if (lead === undefined || rear === undefined) throw new Error('Expected two column units');
    lead.position = mission.area.center;
    lead.personnel = mission.partialMinPersonnel;
    rear.personnel = 0;
    updateOutcome(truth, mission, durationSeconds, 100);
    expect(truth.outcome).toBe('partial');
  });

  it('fails at the deadline with too few through', () => {
    const { truth } = setup();
    updateOutcome(truth, mission, durationSeconds, durationSeconds);
    expect(truth.outcome).toBe('failure');
  });

  it('fails at once when the whole column is gone', () => {
    const { truth, column } = setup();
    for (const unit of column) unit.personnel = 0;
    updateOutcome(truth, mission, durationSeconds, 100);
    expect(truth.outcome).toBe('failure');
  });
});

describe('a second scenario', () => {
  it('has its own policies, kept apart from the outpost set', () => {
    expect(Object.keys(policies(valley))).toEqual([
      'none',
      'reactive',
      'routeRecon',
      'routeReconNoForward',
      'routeReconMark',
      'scoutOnlyMark',
      'scoutOnly',
      'scoutOnlyNoForward',
    ]);
    expect(Object.keys(policies(loadScenarioFile()))).toContain('informed');
  });

  it('plays to a result on a smaller map, and replays exactly', () => {
    const route = policies(valley)['routeRecon']?.();
    if (route === undefined) throw new Error('Missing policy');
    const result = runBattle(valley, 3, route);
    expect(result.outcome).not.toBe('running');
    expect(valley.terrain.width).toBeLessThan(loadScenarioFile().terrain.width);
    const replay = { scenario: 'valley-road', seed: 3, commands: [], ticks: 600 };
    expect(firstDivergence(runReplay(valley, replay), runReplay(valley, replay))).toBeNull();
  });

  it('refuses to replay a log on the wrong scenario', () => {
    expect(() => runReplay(valley, { scenario: 'outpost-under-pressure', seed: 1, commands: [], ticks: 1 })).toThrow(/Replay is for/);
  });

  it('needs recon: scouting the route gets through far more often', () => {
    const wins = (name: string): number =>
      Array.from({ length: 30 }, (_, seed) => seed).filter((seed) => {
        const make = policies(valley)[name];
        if (make === undefined) throw new Error(`Missing ${name}`);
        return runBattle(valley, seed, make()).outcome === 'success';
      }).length;
    expect(wins('routeRecon')).toBeGreaterThan(wins('none') + 5);
  }, 60000);
});
