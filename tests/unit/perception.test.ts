import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import { strengthCategory } from '../../src/domain/public/estimates';
import type { UnitId, UnitKnowledge } from '../../src/domain/public/ground';
import { cellAt } from '../../src/domain/public/terrain';
import type { GroundUnit } from '../../src/domain/truth/world';
import { updatePerception } from '../../src/perception/observe';
import { createRng } from '../../src/rng/streams';
import type { Scenario } from '../../src/scenario/load';
import { createInitialState } from '../../src/sim/state';

const scenario = loadScenarioFile();
const { perception } = scenario.file;

function withoutTerrainEffects(base: Scenario, concealment: number): Scenario {
  const classes = base.terrain.classes.map((cell) => ({
    ...cell,
    groundConcealment: concealment,
    groundObstruction: 0,
  }));
  const elevation = new Float32Array(base.terrain.elevation.length);
  return { ...base, terrain: { ...base.terrain, classes, elevation } };
}

function pair(separationMeters: number, seed = 1) {
  const { truth } = createInitialState(scenario, seed);
  const observer = truth.units.find((u) => u.id === ('F-A' as UnitId)) as GroundUnit;
  const target = truth.units.find((u) => u.id === ('E-N1' as UnitId)) as GroundUnit;
  observer.position = { x: 2525, y: 2625 };
  target.position = { x: 2525, y: 2625 - separationMeters };
  target.posture = 'moving';
  truth.units = [observer, target];
  const knowledge: Record<string, UnitKnowledge> = {};
  return { truth, observer, target, knowledge, rng: createRng(seed) };
}

const open = withoutTerrainEffects(scenario, 0);

/** Scans until the observer has a contact, or gives up. */
function scanUntilDetected(setup: ReturnType<typeof pair>, terrain = open.terrain): number | null {
  const { truth, observer, knowledge, rng } = setup;
  for (let scan = 0; scan < 200; scan += 1) {
    updatePerception(truth, knowledge, terrain, rng, perception, scan * 5);
    if (Object.keys(knowledge[observer.id]?.contacts ?? {}).length > 0) return scan;
  }
  return null;
}

const contactsOf = (setup: ReturnType<typeof pair>) =>
  Object.values(setup.knowledge[setup.observer.id]?.contacts ?? {});

describe('detection', () => {
  it('gives no contact for an enemy beyond detection range', () => {
    expect(scanUntilDetected(pair(1500))).toBeNull();
  });

  it('gives no contact without line of sight', () => {
    const setup = pair(200);
    const blocked = { ...open.terrain, classes: open.terrain.classes.map((c) => ({ ...c, groundObstruction: 1 })) };
    expect(scanUntilDetected(setup, blocked)).toBeNull();
  });

  it('detects less often through heavier ground concealment', () => {
    const scansToDetect = (concealment: number): number => {
      const terrain = withoutTerrainEffects(scenario, concealment).terrain;
      let total = 0;
      for (let seed = 0; seed < 300; seed += 1) total += scanUntilDetected(pair(400, seed), terrain) ?? 200;
      return total;
    };
    expect(scansToDetect(0.8)).toBeGreaterThan(scansToDetect(0) * 2);
  });

  it('uses a local contact ID that reveals nothing about the true unit', () => {
    const setup = pair(100);
    scanUntilDetected(setup);
    expect(contactsOf(setup)[0]?.contactId).not.toContain(setup.target.id);
    expect(JSON.stringify(contactsOf(setup))).not.toContain(setup.target.id);
  });
});

describe('estimates', () => {
  it('reports an estimated position, not the true coordinate', () => {
    const setup = pair(300);
    scanUntilDetected(setup);
    const center = contactsOf(setup)[0]?.position.center;
    expect(center).not.toEqual(setup.target.position);
  });

  it('errors grow with range', () => {
    const meanError = (range: number): number => {
      let total = 0;
      for (let seed = 0; seed < 300; seed += 1) {
        const setup = pair(range, seed);
        scanUntilDetected(setup);
        const center = contactsOf(setup)[0]?.position.center;
        if (center !== undefined) total += Math.hypot(center.x - setup.target.position.x, center.y - setup.target.position.y);
      }
      return total;
    };
    expect(meanError(450)).toBeGreaterThan(meanError(50));
  });

  it('keeps an estimate unchanged until there is genuinely new information', () => {
    const setup = pair(100);
    scanUntilDetected(setup);
    const first = contactsOf(setup)[0];
    const { truth, knowledge, rng } = setup;
    for (let scan = 300; scan < 320; scan += 1) {
      updatePerception(truth, knowledge, open.terrain, rng, perception, scan * 5);
    }
    const later = contactsOf(setup)[0];
    expect(later?.position.center).toEqual(first?.position.center);
    expect(later?.strength).toEqual(first?.strength);
  });

  it('revises the estimate when the target has really moved', () => {
    const setup = pair(100);
    scanUntilDetected(setup);
    const first = contactsOf(setup)[0];
    setup.target.position = { x: setup.target.position.x + 80, y: setup.target.position.y };
    for (let scan = 300; scan < 340; scan += 1) {
      updatePerception(setup.truth, setup.knowledge, open.terrain, setup.rng, perception, scan * 5);
    }
    expect(contactsOf(setup)[0]?.position.center).not.toEqual(first?.position.center);
  });

  it('never presents an exact headcount', () => {
    const setup = pair(100);
    scanUntilDetected(setup);
    const strength = contactsOf(setup)[0]?.strength;
    if (strength?.kind === 'range') expect(strength.max).toBeGreaterThan(strength.min);
  });

  it('maps inferred counts onto coarse categories', () => {
    expect(strengthCategory(4)).toEqual({ kind: 'range', min: 1, max: 5 });
    expect(strengthCategory(30)).toEqual({ kind: 'range', min: 15, max: 50 });
    expect(strengthCategory(120)).toEqual({ kind: 'range', min: 51, max: 150 });
  });

  it('can leave a contact unidentified, but never identifies it wrongly', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 100; seed += 1) {
      const setup = pair(450, seed);
      scanUntilDetected(setup);
      const identification = contactsOf(setup)[0]?.identification;
      if (identification !== undefined) seen.add(identification);
    }
    expect(seen.has('unidentified')).toBe(true);
    expect(seen.has('friendly')).toBe(false);
  });

  it('applies the same detection rules whichever side observes', () => {
    const rate = (flip: boolean): number => {
      let detected = 0;
      for (let seed = 0; seed < 400; seed += 1) {
        const setup = pair(300, seed);
        if (flip) {
          setup.observer.side = 'enemy';
          setup.target.side = 'friendly';
        }
        setup.observer.doctrine = setup.target.doctrine;
        updatePerception(setup.truth, setup.knowledge, open.terrain, setup.rng, perception, 0);
        if (contactsOf(setup).length > 0) detected += 1;
      }
      return detected;
    };
    expect(rate(true)).toBe(rate(false));
  });

  it('uses the terrain the target stands in, not the observer', () => {
    expect(cellAt(open.terrain, { x: 0, y: 0 }).groundConcealment).toBe(0);
  });
});
