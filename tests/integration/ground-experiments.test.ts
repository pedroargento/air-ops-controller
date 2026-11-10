import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/cli/battle';
import { GroundDiagnostics } from '../../src/cli/ground-diagnostics';
import { loadScenarioFile, scenarioNames } from '../../src/cli/load-scenario';
import { applySettings } from '../../src/cli/settings';
import { scenarioFileSchema } from '../../src/scenario/schema';
import { noAir } from '../../src/policies/air-policies';
import { hashState } from '../../src/domain/public/hash';
import { createInitialState } from '../../src/sim/state';
import { selfViews, step } from '../../src/sim/step';

describe('ground experiment instrumentation', () => {
  it('defaults shipped scenarios and files without the new setting to standard tactics', () => {
    for (const name of scenarioNames()) {
      const scenario = loadScenarioFile(name);
      expect(scenario.file.ground.experimentalTactics).toBe(false);
      expect(Object.values(scenario.doctrines).every((d) => !d.experimentalTactics)).toBe(true);
      expect(scenario.doctrines['assault']?.drills).toEqual([]);
      expect(scenarioFileSchema.parse({ ...scenario.file, ground: undefined }).ground.experimentalTactics).toBe(false);
    }
  });

  it('resolves opt-in drills for both sides and removes them when switched back off', () => {
    const original = loadScenarioFile('valley-road');
    const enabled = applySettings(original, ['ground.experimentalTactics=true']);
    expect(enabled.doctrines['assault']?.drills).toContain('attack');
    const state = createInitialState(enabled, 1);
    for (const platoon of Object.values(state.truth.platoons)) expect(platoon.doctrine.experimentalTactics).toBe(true);
    const disabled = applySettings(enabled, ['ground.experimentalTactics=false']);
    expect(disabled.doctrines).toEqual(original.doctrines);
    expect(original.file.ground.experimentalTactics).toBe(false);
  });

  it('runs coordinated phases only when explicitly enabled', () => {
    for (const enabled of [false, true]) {
      const scenario = applySettings(loadScenarioFile('valley-road'), [`ground.experimentalTactics=${enabled}`]);
      let coordinated = false, assigned = false;
      runBattle(scenario, 1, noAir, (state) => {
        for (const p of Object.values(state.truth.platoons)) {
          coordinated ||= p.drillPhase !== null;
          assigned ||= p.squads.some((s) => s.role !== null);
        }
      });
      expect(coordinated).toBe(enabled);
      expect(assigned).toBe(true);
    }
  });

  it.each([false, true])('gate overrides (%s) cannot enable experimental tactics', (gate) => {
    const scenario = loadScenarioFile('valley-road');
    const baseline = runBattle(scenario, 1, noAir);
    const diagnostics = new GroundDiagnostics();
    const measured = runBattle({ ...scenario, groundExperiment: {
      supportGate: gate, assemblyGate: gate, attackReassessment: gate,
    } }, 1, noAir, (state) => diagnostics.observe(state));
    expect(measured).toEqual(baseline);
    expect(diagnostics.sides.friendly.activeSquadSeconds).toBeGreaterThan(0);
  });

  it('counts exposed waiting and casualties without modifying truth or exposing diagnostics to units', () => {
    const scenario = loadScenarioFile('valley-road');
    const state = createInitialState(scenario, 1);
    step(state, [], scenario);
    const platoon = Object.values(state.truth.platoons).find((p) => p.side === 'friendly');
    const unit = platoon?.squads[0];
    if (!platoon || !unit) throw new Error('Missing platoon');
    platoon.drillWaitReason = 'support';
    platoon.drillPhase = 'establish';
    platoon.handled = [{ center: unit.position, tick: 0, failed: true, reason: 'support-timeout' }];
    unit.role = 'maneuver';
    unit.intent = { kind: 'hold', posture: 'prone' };
    unit.lastHitAtTick = 0;
    unit.personnel -= 1;
    const before = hashState(state);
    const diagnostics = new GroundDiagnostics();
    diagnostics.observe(state);
    expect(hashState(state)).toBe(before);
    expect(diagnostics.sides.friendly.supportWaitPersonnelLost).toBe(1);
    expect(diagnostics.sides.friendly.exposedSupportWaitSquadSeconds).toBeGreaterThan(0);
    expect(diagnostics.sides.friendly.supportTimeouts).toBe(1);
    state.tick++;
    diagnostics.observe(state);
    expect(diagnostics.sides.friendly.supportWaitPersonnelLost).toBe(1);
    expect(diagnostics.sides.friendly.supportTimeouts).toBe(1);
    expect(selfViews(state, scenario).platoons.get(platoon.id)).not.toHaveProperty('drillWaitReason');
  });
});
