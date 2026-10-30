import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/cli/battle';
import { noAir, reconInformed } from '../../src/policies/air-policies';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import { canonicalJson } from '../../src/domain/public/hash';
import { AIR_OPS, CECON, type RadioMessage } from '../../src/domain/public/radio';
import { project } from '../../src/knowledge/player-view';
import { aircraftTelemetry } from '../../src/sim/air';
import { createInitialState, type SimState } from '../../src/sim/state';
import { step } from '../../src/sim/step';

const scenario = loadScenarioFile();
const { display } = scenario.file;

function runTo(seed: number, ticks: number): SimState {
  const state = createInitialState(scenario, seed);
  for (let tick = 0; tick < ticks && state.truth.outcome === 'running'; tick += 1) step(state, [], scenario);
  return state;
}

describe('projection boundary', () => {
  it('does not depend on hidden truth: scrambling truth leaves PlayerView identical', () => {
    const state = runTo(1, 2400);
    const before = canonicalJson(project(state.player, [], state.tick, display));
    for (const unit of state.truth.units) {
      unit.position = { x: 1, y: 1 };
      unit.personnel = 1;
      unit.morale = 0;
    }
    state.truth.tracks = {};
    expect(canonicalJson(project(state.player, [], state.tick, display))).toBe(before);
  });

  it('exposes no true unit state, enemy identity or private track data', () => {
    const state = runTo(1, 2400);
    const view = canonicalJson(project(state.player, [], state.tick, display));
    const enemies = state.truth.units.filter((u) => u.side === 'enemy');
    for (const enemy of enemies) {
      expect(view).not.toContain(`"${enemy.id}"`);
      expect(view).not.toContain(enemy.name);
      expect(view).not.toContain(canonicalJson(enemy.position));
    }
    for (const key of ['errorOffset', 'anchor', 'lastSeenPosition', 'navOffset', 'personnelTrue']) {
      expect(view).not.toContain(key);
    }
  });
});

describe('autonomous battle', () => {
  const state = runTo(1, 3000);
  const log = state.player.log;
  const bySender = (kind: RadioMessage['kind']) => log.filter((m) => m.kind === kind);

  it('produces TICs without any scripted event', () => {
    expect(bySender('TIC').length).toBeGreaterThan(0);
  });

  it('TICs carry a plausible, imperfect friendly position', () => {
    const tic = bySender('TIC')[0];
    if (tic?.kind !== 'TIC') throw new Error('expected a TIC');
    const unit = state.truth.units.find((u) => u.id === tic.senderId);
    expect(unit).toBeDefined();
    expect(tic.ownPosition.sigmaMeters).toBeGreaterThan(0);
  });

  it('reports arrive after they were observed and sent', () => {
    for (const message of log) {
      if (message.senderId === CECON) continue;
      expect(message.receivedAt).toBeGreaterThanOrEqual(message.sentAt);
      expect(message.sentAt).toBeGreaterThanOrEqual(message.observedAt);
    }
    expect(log.some((m) => m.receivedAt > m.sentAt)).toBe(true);
  });

  it('delivers only friendly and CECON traffic to the player', () => {
    const friendly = new Set(scenario.file.units.filter((u) => u.side === 'friendly').map((u) => u.id as string));
    friendly.add(CECON);
    for (const message of log) expect(friendly.has(message.senderId)).toBe(true);
  });

  it('runs radio for enemy formations too, reaching their linked units but not the player', () => {
    const received = state.unitKnowledge['E-N2']?.reports ?? {};
    const allEnemyReports = Object.values(state.unitKnowledge)
      .flatMap((k) => Object.values(k.reports))
      .filter((r) => r.provenance.sourceId.startsWith('E-'));
    expect(Object.keys(received).length + allEnemyReports.length).toBeGreaterThan(0);
    expect(scenario.file.links.some(([a, b]) => a.startsWith('E-') && b === AIR_OPS)).toBe(false);
  });

  it('does not reveal ground-to-ground traffic to the player', () => {
    const relayed = scenario.file.links.filter(([a, b]) => a !== AIR_OPS && b !== AIR_OPS);
    expect(relayed.length).toBeGreaterThan(0);
    expect(log.every((m) => m.kind !== 'INTEL_REPORT')).toBe(true);
  });

  it('delivers the scenario-defined CECON messages', () => {
    expect(bySender('COMMAND_UPDATE').length).toBeGreaterThan(0);
  });
});

describe('radio balance', () => {
  it('keeps aircraft from dominating the log, and keeps ground units talking', () => {
    const state = createInitialState(scenario, 1);
    const objective = scenario.file.capture.area.center;
    const policy = reconInformed(objective, true);
    while (state.truth.outcome === 'running') {
      const view = project(state.player, aircraftTelemetry(state.truth, scenario.file.air), state.tick, display);
      step(state, state.tick % 5 === 0 ? policy(view) : [], scenario);
    }
    const reports = state.player.log.filter((m) => m.kind !== 'COMMAND_UPDATE' && m.kind !== 'STRIKE_RESULT');
    const air = reports.filter((m) => /^(RECON|CAS)-/.test(m.senderId));
    const ground = reports.length - air.length;
    expect(air.length).toBeLessThan(ground / 3);
    expect(state.player.log.filter((m) => m.kind === 'SITREP').length).toBeGreaterThan(0);
    const earlyGround = reports.filter((m) => m.receivedAt < 1800 && !/^(RECON|CAS)-/.test(m.senderId));
    expect(earlyGround.length).toBeGreaterThanOrEqual(12);
  });
});

describe('perception in battle', () => {
  it('still lets ground forces fight and decide battles', () => {
    const result = runBattle(scenario, 3, noAir);
    expect(result.firstShotTick).not.toBeNull();
    expect(result.outcome).not.toBe('running');
  });
});
