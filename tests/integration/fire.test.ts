import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import { runBattle } from '../../src/cli/battle';
import { policies } from '../../src/cli/policy-registry';
import { atan2 } from '../../src/domain/public/det-math';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import { emptyKnowledge, type ContactId } from '../../src/domain/public/ground';
import type { RadioMessage } from '../../src/domain/public/radio';
import type { GroundUnit } from '../../src/domain/truth/world';
import { fireLines } from '../../src/knowledge/fire-view';
import { emptyPlayerKnowledge, receiveByPlayer } from '../../src/knowledge/player-knowledge';
import { project } from '../../src/knowledge/player-view';
import { composeReport } from '../../src/ai/report';
import { updateFireKnowledge } from '../../src/perception/fire';
import { aircraftTelemetry } from '../../src/sim/air';
import { createInitialState, type SimState } from '../../src/sim/state';
import type { MessageId } from '../../src/domain/public/radio';

const outpost = loadScenarioFile('outpost-under-pressure');
const { perception, display } = outpost.file;

const contactAt = (id: string, x: number, y: number, tick: number, source = 'F-A'): ContactEstimate => ({
  contactId: id as ContactId,
  provenance: { sourceId: source, observedAt: tick },
  identification: 'hostile',
  position: { center: { x, y }, sigmaMeters: 40, headingRad: null, speedMps: null, observedAt: tick },
  strength: { kind: 'range', min: 8, max: 15 },
  kind: 'infantry',
  activity: 'engaging',
  confidence: 'medium',
  observedWeapons: [],
});

/** A friendly squad of F-A and an enemy squad, the enemy firing at it this tick. */
function shotAt(seen: boolean): { state: SimState; squad: GroundUnit; enemy: GroundUnit } {
  const state = createInitialState(outpost, 1);
  state.tick = 100;
  const squad = state.truth.units.find((unit) => unit.platoonId === 'F-A') as GroundUnit;
  const enemy = state.truth.units.find((unit) => unit.side === 'enemy') as GroundUnit;
  enemy.position = { x: squad.position.x + 300, y: squad.position.y - 300 };
  squad.shotBy[enemy.id] = state.tick;
  if (seen) {
    const contact = contactAt('C-9', enemy.position.x + 20, enemy.position.y, state.tick);
    (state.unitKnowledge['F-A'] ??= emptyKnowledge()).contacts['C-9'] = contact;
    state.truth.tracks['F-A'] = {
      [enemy.id]: {
        contactId: 'C-9' as ContactId,
        anchor: enemy.position,
        sampleRange: 400,
        errorOffset: { x: 20, y: 0 },
        lastActivity: 'engaging',
        lastSeenPosition: enemy.position,
        lastSeenTick: state.tick,
        estimate: contact,
      },
    };
  }
  return { state, squad, enemy };
}

describe('fire on the ground (§7.3)', () => {
  it('knows fire comes from a shooter it can see, as its own contact', () => {
    const { state } = shotAt(true);
    updateFireKnowledge(state.truth, state.unitKnowledge, state.rng, perception, state.tick);
    const fire = state.unitKnowledge['F-A']!.fire;
    expect(fire.since).toBe(100);
    expect(fire.from['C-9']?.contact?.contactId).toBe('C-9');
  });

  it('has only a rough direction for a shooter it can\'t see', () => {
    const { state, squad, enemy } = shotAt(false);
    updateFireKnowledge(state.truth, state.unitKnowledge, state.rng, perception, state.tick);
    const from = Object.values(state.unitKnowledge['F-A']!.fire.from);
    expect(from).toHaveLength(1);
    const [source] = from;
    expect(source?.contact).toBeNull();
    const truth = atan2(enemy.position.y - squad.position.y, enemy.position.x - squad.position.x);
    expect(Math.abs((source?.bearingRad ?? 0) - truth)).toBeLessThan(4 * perception.fireBearingErrorRad);
    expect(source?.spreadRad).toBeGreaterThan(0);
  });

  it('knows what it is shooting at, and forgets the fight once it stops', () => {
    const { state, squad } = shotAt(true);
    const contact = state.unitKnowledge['F-A']!.contacts['C-9']!;
    squad.intent = { kind: 'engage', aim: contact.position.center, closeTo: null, fireRate: 1, prepared: false };
    squad.lastFiredAtTick = state.tick;
    updateFireKnowledge(state.truth, state.unitKnowledge, state.rng, perception, state.tick);
    expect(state.unitKnowledge['F-A']!.fire.engaging['C-9']).toBe(100);
    state.tick += perception.fireMemorySeconds + 5;
    state.unitKnowledge['F-A']!.contacts['C-9'] = { ...contact, position: { ...contact.position, observedAt: state.tick } };
    updateFireKnowledge(state.truth, state.unitKnowledge, state.rng, perception, state.tick);
    const fire = state.unitKnowledge['F-A']!.fire;
    expect(fire.since).toBeNull();
    expect(Object.keys(fire.from)).toHaveLength(0);
    expect(Object.keys(fire.engaging)).toHaveLength(0);
  });

  it('reports its fight, and a later report without one clears it', () => {
    const { state } = shotAt(true);
    updateFireKnowledge(state.truth, state.unitKnowledge, state.rng, perception, state.tick);
    const knowledge = state.unitKnowledge['F-A']!;
    const self = { id: 'F-A', ownPosition: { center: { x: 0, y: 0 }, sigmaMeters: 10, headingRad: null, speedMps: null, observedAt: 100 } } as Parameters<typeof composeReport>[1];
    const report = composeReport({ kind: 'POSITION_REPORT', contactId: null }, self, knowledge, 'M-1' as MessageId, 100, 120) as RadioMessage;
    expect(report.kind === 'POSITION_REPORT' ? report.fire?.underFire : undefined).toBe(true);
    const player = emptyPlayerKnowledge();
    receiveByPlayer(player, report, 60);
    expect(player.unitFire['F-A']?.status.from[0]?.contact?.contactId).toBe('C-9');
    const quiet = composeReport({ kind: 'POSITION_REPORT', contactId: null }, self, emptyKnowledge(), 'M-2' as MessageId, 400, 420) as RadioMessage;
    receiveByPlayer(player, quiet, 60);
    expect(player.unitFire['F-A']).toBeUndefined();
  });

  it('draws reported fire dashed, seen fire solid, and an unseen shooter as a wedge', () => {
    const player = emptyPlayerKnowledge();
    const own = { center: { x: 1000, y: 1000 }, sigmaMeters: 10, headingRad: null, speedMps: null, observedAt: 100 };
    player.friendlies['F-A'] = { unitId: 'F-A', position: own, source: 'self-report', receivedAt: 100 };
    const shooter = contactAt('C-9', 1300, 700, 100);
    player.unitFire['F-A'] = {
      ownPosition: own,
      receivedAt: 110,
      observedAt: 100,
      status: {
        underFire: true,
        intensity: 'heavy',
        since: 90,
        from: [
          { contact: shooter, bearingRad: 0, spreadRad: 0, origin: own.center, observedAt: 100 },
          { contact: null, bearingRad: Math.PI / 2, spreadRad: 0.35, origin: own.center, observedAt: 100 },
        ],
        engaging: [shooter],
      },
    };
    const lookup = () => null;
    const reported = fireLines(player, lookup, 120, display);
    expect(reported.filter((line) => !line.seen)).toHaveLength(3);
    expect(reported.find((line) => line.from === null)?.spreadRad).toBe(0.35);
    expect(reported.find((line) => line.from?.kind === 'contact')?.heavy).toBe(true);

    player.seenFire['F-A/C-9'] = { from: { kind: 'contact', key: 'F-A/C-9', contact: shooter }, to: { kind: 'friendly', unitId: 'F-A' }, bearingRad: 0, seenAt: 118, aircraftId: 'RECON-1' };
    const lines = fireLines(player, lookup, 120, display);
    const onUnit = lines.filter((line) => line.from?.kind === 'contact' && line.to?.kind === 'friendly');
    expect(onUnit).toHaveLength(1);
    expect(onUnit[0]?.seen).toBe(true);
    expect(fireLines(player, lookup, 120 + display.fireLineSeconds + 1, display)).toHaveLength(0);
  });

  it('shows the fight at the outpost from reports and crews, without changing it', () => {
    const scenario = outpost;
    let lines = 0;
    let underFire = 0;
    let seen = 0;
    runBattle(scenario, 1, policies(scenario)['informed']!(), (state) => {
      if (state.tick % 300 !== 0) return;
      const view = project(state.player, aircraftTelemetry(state.truth, scenario.file.air, state.tick), state.tick, scenario.file.display);
      lines = Math.max(lines, view.fire.length);
      seen = Math.max(seen, view.fire.filter((line) => line.seen).length);
      underFire = Math.max(underFire, view.friendlies.filter((friendly) => friendly.underFire !== null).length);
    });
    expect(lines).toBeGreaterThan(5);
    expect(seen).toBeGreaterThan(0);
    expect(underFire).toBeGreaterThanOrEqual(2);
  });
});
