import { describe, expect, it } from 'vitest';
import { applySettings } from '../../src/cli/settings';
import { coordinateDrill } from '../../src/ai/coordinate-ground';
import { decideGround, decidePlatoon } from '../../src/ai/decide-ground';
import { search } from '../../src/ai/decide-evade';
import { nextDrill } from '../../src/ai/drills';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import { distance } from '../../src/domain/public/geometry';
import { emptyKnowledge, type Drill, type DrillMap, type SquadStatus, type UnitId, type UnitSelf } from '../../src/domain/public/ground';
import { createInitialState } from '../../src/sim/state';
import { selfViews } from '../../src/sim/step';
import { resolveCombat } from '../../src/sim/combat';

const scenario = applySettings(loadScenarioFile('valley-road'), ['ground.experimentalTactics=true']);
const rates = scenario.file.combat.behaviorFireRate;
const map: DrillMap = { sees: () => true, cover: () => 0, routeMeters: (a, b) => distance(a, b) };
const target = { x: 250, y: 0 };
const drill: Drill = { kind: 'attack', startedAt: 0, target, radius: 100, via: { x: 250, y: 200 }, avoid: { center: target, radius: 150 }, warned: true };
const squad = (id: string, overrides: Partial<SquadStatus> = {}): SquadStatus => ({
  id: id as UnitId, position: { x: 0, y: 0 }, personnel: 10, ammunition: 1000,
  supportWeapons: 1, suppression: 0, underFire: false, role: 'maneuver', viaDone: false, groundVolley: null, ...overrides,
});
function self(overrides: Partial<UnitSelf> = {}): UnitSelf {
  const state = createInitialState(scenario, 1);
  const own = selfViews(state, scenario).platoons.get('F-C1');
  if (own === undefined) throw new Error('Missing platoon');
  return { ...own, position: { x: 0, y: 0 }, platoonPersonnel: 30, platoonFree: 30, personnel: 30, initialPersonnel: 30,
    ammunition: 3000, initialAmmunition: 3000, morale: 0.8, drill,
    ownSquads: [squad('A', { role: 'support', supportWeapons: 2 }), squad('B'), squad('C')],
    routeAhead: [target], secondsLeft: 7200, objective: { kind: 'MoveTo', area: { center: { x: 2000, y: 0 }, radius: 100 } },
    fallback: { center: { x: -500, y: 0 }, radius: 100 }, ...overrides };
}
const contact = (at = 100, strength = 10): ContactEstimate => ({
  contactId: 'C-1' as ContactEstimate['contactId'], provenance: { sourceId: 'RECON', observedAt: at }, identification: 'hostile',
  position: { center: target, observedAt: at, sigmaMeters: 50, headingRad: null, speedMps: null },
  strength: { kind: 'range', min: strength, max: strength }, kind: 'infantry', activity: 'stationary', confidence: 'medium', observedWeapons: [],
});
const reported = (at = 100, strength = 10) => ({ ...emptyKnowledge(), reports: { report: contact(at, strength) } });
const firing = () => [squad('A', { role: 'support', supportWeapons: 2, groundVolley: { aim: target, at: 95 } }), squad('B'), squad('C')];
const gates = { supportGate: true, assemblyGate: true, attackReassessment: true };

function coordinate(own: UnitSelf, tick = 100, terrain = map) {
  return coordinateDrill(own, emptyKnowledge(), drill, tick, terrain);
}

describe('platoon fire and movement', () => {
  it('isolates support and assembly barriers without removing approach or individual waypoints', () => {
    const unsupported = self();
    expect(coordinateDrill(unsupported, emptyKnowledge(), drill, 100, map, { ...gates, supportGate: false }).phase).toBe('maneuver');
    const remote = { ...drill, target: { x: 2000, y: 0 } };
    expect(coordinateDrill(unsupported, emptyKnowledge(), remote, 100, map, { ...gates, supportGate: false }).phase).toBe('approach');
    const own = self({ ownSquads: firing(), role: 'maneuver', drillPhase: 'assault', viaDone: false });
    expect(coordinateDrill(own, emptyKnowledge(), drill, 100, map, { ...gates, assemblyGate: false }).phase).toBe('assault');
    const intent = decideGround(own, emptyKnowledge(), 100, rates, map).intent;
    expect(intent.kind).toBe('move');
    if (intent.kind === 'move') expect(intent.destination).not.toEqual(drill.target);
  });
  it('establishes actual supporting fire before maneuver, even with a clear firing position', () => {
    expect(coordinate(self()).phase).toBe('establish');
    expect(coordinate(self({ ownSquads: firing() })).phase).toBe('maneuver');
  });

  it('pauses for stale, obstructed, or misdirected support', () => {
    expect(coordinate(self({ ownSquads: firing() }), 120).phase).toBe('establish');
    expect(coordinate(self({ ownSquads: firing() }), 100, { ...map, sees: () => false }).phase).toBe('establish');
    const wrong = firing().map((s) => ({ ...s, groundVolley: { aim: { x: -500, y: 0 }, at: 95 } }));
    expect(coordinate(self({ ownSquads: wrong })).phase).toBe('establish');
  });

  it.each(['ammunition', 'suppression', 'personnel'] as const)('reassigns support after losing %s capability', (field) => {
    const members = firing().map((s) => s.id === 'A' ? { ...s, [field]: field === 'suppression' ? 1 : 0 } : s);
    const result = coordinate(self({ ownSquads: members }));
    expect(result.roles['B']).toBe('support');
    expect(result.phase).toBe('establish');
  });

  it('does not turn a depleted platoon into an unsupported solo assault', () => {
    const result = coordinate(self({ ownSquads: [squad('B')] }));
    expect(result).toEqual({ phase: 'establish', roles: { B: 'cover' }, waitReason: 'capacity' });
  });

  it('assembles maneuver squads before closing and halts when support is lost', () => {
    const members = firing().map((s) => s.role === 'maneuver' ? { ...s, viaDone: true } : s);
    expect(coordinate(self({ ownSquads: members })).phase).toBe('assault');
    const own = self({ role: 'maneuver', viaDone: true, drillPhase: 'establish' });
    expect(decideGround(own, emptyKnowledge(), 100, rates, map).intent.kind).toBe('hold');
    expect(decideGround({ ...own, drillPhase: 'assault' }, emptyKnowledge(), 100, rates, map).intent.kind).toBe('move');
  });

  it('approaches distant objectives together before establishing support', () => {
    const remote = { ...drill, target: { x: 2000, y: 0 } };
    const own = self({ drill: remote });
    expect(coordinateDrill(own, emptyKnowledge(), remote, 100, map).phase).toBe('approach');
    expect(decideGround({ ...own, role: 'maneuver', drillPhase: 'approach' }, emptyKnowledge(), 100, rates, map).intent.kind).toBe('move');
  });

  it('uses distinct flank assembly positions', () => {
    const own = self({ role: 'maneuver', drillPhase: 'maneuver' });
    const a = decideGround({ ...own, slot: { x: 0, y: 0.7 } }, emptyKnowledge(), 100, rates, map);
    const b = decideGround({ ...own, slot: { x: 0, y: -0.7 } }, emptyKnowledge(), 100, rates, map);
    expect(a.intent.kind).toBe('move');
    expect(b.intent.kind).toBe('move');
    expect(a.intent).not.toEqual(b.intent);
  });

  it('finds a firing position for a reported target without needing a visual contact', () => {
    const terrain = { ...map, sees: (from: { x: number; y: number }) => from.y > 0 };
    const decision = decideGround(self({ role: 'support' }), reported(), 100, rates, terrain);
    expect(decision.intent.kind).toBe('move');
    if (decision.intent.kind !== 'move') throw new Error('Expected reposition');
    expect(terrain.sees(decision.intent.destination)).toBe(true);
  });

  it('answers near ambush only with exposed squads', () => {
    const own = self({ ownSquads: [squad('A', { position: { x: 200, y: 0 }, underFire: true }), squad('B')] });
    const result = coordinateDrill(own, emptyKnowledge(), { ...drill, kind: 'nearAmbush' }, 100, map);
    expect(result.roles).toEqual({ A: 'assault', B: 'support' });
  });
});

describe('bounded support waiting', () => {
  it('ignores coordination waits and their budget when the experimental switch is off', () => {
    const own = self();
    const standard = { ...own, doctrine: { ...own.doctrine, experimentalTactics: false, supportWaitSeconds: 2 },
      drill: { ...drill, supportWait: { seconds: 100, checkedAt: 100, waiting: true } } };
    const decision = decidePlatoon(standard, reported(), 100, map, gates);
    expect(decision.coordination).toBeNull();
    expect(decision.drill?.kind).toBe('attack');
    expect(decision.handled).toEqual([]);
    expect(decideGround({ ...standard, role: 'maneuver', viaDone: true, drillPhase: 'establish' }, emptyKnowledge(), 100, rates, map).intent.kind).toBe('move');
  });

  function waiting() {
    const own = self();
    return { ...own, doctrine: { ...own.doctrine, supportWaitSeconds: 2 } };
  }

  it('bypasses after the wait budget and lets the alternate drill move immediately', () => {
    const own = waiting();
    const first = decidePlatoon(own, reported(), 100, map);
    expect(first.coordination?.waitReason).toBe('support');
    const expired = decidePlatoon({ ...own, drill: first.drill }, reported(102), 102, map);
    expect(expired.drill?.kind).toBe('bypass');
    expect(expired.handled.at(-1)).toMatchObject({ failed: true, reason: 'support-timeout' });
    const squadDecision = decideGround({ ...own, drill: expired.drill, handled: expired.handled, role: 'bypass' }, reported(102), 102, rates, map);
    expect(squadDecision.intent.kind).toBe('move');
  });

  it('withdraws when terrain makes a detour too costly, preserving the mission objective', () => {
    const own = waiting();
    const costly = { ...map, routeMeters: (a: { x: number; y: number }, b: { x: number; y: number }, avoid: unknown) => distance(a, b) * (avoid ? 100 : 1) };
    const first = decidePlatoon(own, reported(), 100, costly);
    const expired = decidePlatoon({ ...own, drill: first.drill }, reported(102), 102, costly);
    expect(expired.mode).toBe('withdrawing');
    expect(expired.drill).toBeNull();
    expect(expired.objectiveDone).toBe(false);
    expect(expired.handled.at(-1)?.reason).toBe('support-timeout');
  });

  it('accumulates waiting across brief support and excludes time spent maneuvering', () => {
    const own = waiting();
    const first = decidePlatoon(own, reported(), 100, map);
    const fire = firing().map((s) => s.id === 'A' ? { ...s, groundVolley: { aim: target, at: 101 } } : s);
    const supported = decidePlatoon({ ...own, drill: first.drill, ownSquads: fire }, reported(101), 101, map);
    expect(supported.drill?.supportWait).toEqual({ seconds: 1, checkedAt: 101, waiting: false });
    const stalled = decidePlatoon({ ...own, drill: supported.drill }, reported(120), 120, map);
    expect(stalled.drill?.supportWait).toEqual({ seconds: 1, checkedAt: 120, waiting: true });
    const expired = decidePlatoon({ ...own, drill: stalled.drill }, reported(121), 121, map);
    expect(expired.handled.at(-1)?.reason).toBe('support-timeout');
  });

  it('does not charge approach, doctrine refusal, or assembly to the support budget', () => {
    const own = waiting();
    const approach = decidePlatoon({ ...own, drill: { ...drill, target: { x: 2000, y: 1000 } } }, emptyKnowledge(), 100, map);
    expect(approach.drill?.supportWait?.waiting).toBe(false);
    const refusal = decidePlatoon({ ...own, objective: { kind: 'AssaultArea', area: { center: target, radius: 100 } },
      doctrine: { ...own.doctrine, assaultBias: 0.01, observeBias: 1 } }, reported(), 100, map);
    expect(refusal.coordination?.waitReason).toBe('doctrine');
    expect(refusal.drill?.supportWait?.waiting).toBe(false);
    const assembly = decidePlatoon({ ...own, ownSquads: firing().map((s) => s.id === 'B' ? { ...s, viaDone: true } : s) }, reported(), 100, map);
    expect(assembly.coordination?.waitReason).toBe('assembly');
    expect(assembly.drill?.supportWait?.waiting).toBe(false);
  });
});

describe('doctrine and reassessment', () => {
  it('restores the standard attack fallback when a strong reported position cannot be bypassed', () => {
    const own = self({ drill: null });
    const terrain = { ...map, routeMeters: (a: { x: number; y: number }, b: { x: number; y: number }, avoid: unknown) => distance(a, b) * (avoid ? 100 : 1) };
    expect(nextDrill(own, reported(100, 300), 100, terrain).drill).toBeNull();
    const standard = { ...own, doctrine: { ...own.doctrine, experimentalTactics: false } };
    expect(nextDrill(standard, reported(100, 300), 100, terrain).drill?.kind).toBe('attack');
  });

  it('keeps cautious doctrine from assaulting just because it knows the drill', () => {
    const own = self({ doctrine: { ...self().doctrine, assaultBias: 0.1, observeBias: 1 }, ownSquads: firing() });
    expect(coordinate(own).phase).toBe('establish');
    expect(nextDrill({ ...own, drill: null }, reported(), 100, map).drill?.kind).toBe('bypass');
  });

  it.each([false, true])('keeps failed-threat handling with experimental tactics %s', (experimentalTactics) => {
    const own = self({ doctrine: { ...self().doctrine, experimentalTactics } });
    const end = own.doctrine.drillSeconds;
    const expired = nextDrill(own, reported(end), end, map);
    expect(expired.finished).toBeNull();
    expect(expired.handled.at(-1)?.failed).toBe(true);
    const waiting = { ...own, drill: null, handled: expired.handled };
    expect(nextDrill(waiting, reported(end + 5), end + 5, map).drill).toBeNull();
    expect(decideGround(waiting, reported(end + 5), end + 5, rates, map).intent.kind).toBe('hold');
    const retry = end + own.doctrine.pauseSeconds;
    expect(nextDrill(waiting, reported(retry), retry, map).drill?.kind).toBe('attack');
  });

  it('retains a progressing flank past its original time limit but ends a stalled one', () => {
    const own = self({ ownSquads: [squad('A', { role: 'support' }), squad('B', { position: { x: 200, y: 200 } })] });
    const active = { ...drill, progress: { at: 0, remainingMeters: 500 } };
    const advancing = nextDrill({ ...own, drill: active }, reported(600), 600, map);
    expect(advancing.drill?.startedAt).toBe(0);
    expect(advancing.drill?.progress?.at).toBe(600);
    expect(advancing.handled).toEqual([]);
    const end = 600 + own.doctrine.drillSeconds;
    const stalled = nextDrill({ ...own, drill: advancing.drill }, reported(end), end, map);
    expect(stalled.drill).toBeNull();
    expect(stalled.handled.at(-1)?.failed).toBe(true);
  });

  it.each([false, true])('does not clear an objective under fire with experimental tactics %s', (experimentalTactics) => {
    const own = self({ position: target, underFire: true, doctrine: { ...self().doctrine, experimentalTactics } });
    const decision = nextDrill(own, emptyKnowledge(), 100, map);
    expect(decision.finished).toBeNull();
    expect(decision.drill?.kind).toBe('attack');
  });

  it('applies doctrine to a solo attack too', () => {
    const own = self({ ownSquads: [squad('A')], doctrine: { ...self().doctrine, assaultBias: 0, observeBias: 1 } });
    expect(coordinateDrill(own, emptyKnowledge(), { ...drill, via: null }, 100, map)).toEqual({ phase: 'establish', roles: { A: 'cover' }, waitReason: 'doctrine' });
  });

  it.each([false, true])('reopens completed positions for fresh evidence with experimental tactics %s', (experimentalTactics) => {
    const own = self({ drill: null, handled: [{ center: target, tick: 100 }], doctrine: { ...self().doctrine, experimentalTactics } });
    expect(nextDrill(own, reported(90), 110, map).drill).toBeNull();
    expect(nextDrill(own, reported(105), 110, map).drill?.kind).toBe('attack');
  });

  it('reconsiders an ongoing assault when fresh reports make it unfavorable', () => {
    const own = self({ drill: null, behavior: 'assault', behaviorSinceTick: 95, ammunition: 100 });
    const knowledge = { ...reported(100, 300), contacts: { 'C-1': contact(100, 300) } };
    expect(decideGround(own, knowledge, 100, rates, map).behavior).not.toBe('assault');
  });

  it('does not label prolonged or warned close contact a surprise ambush', () => {
    const near = { ...contact(), position: { ...contact().position, center: { x: 50, y: 0 } } };
    const knowledge = { ...emptyKnowledge(), contacts: { 'C-1': near } };
    knowledge.fire.since = 95;
    const own = self({ drill: null, underFire: true });
    expect(nextDrill(own, knowledge, 100, map).drill?.kind).toBe('nearAmbush');
    knowledge.fire.since = 0;
    expect(nextDrill(own, knowledge, 100, map).drill?.kind).toBe('farAmbush');
    knowledge.fire.since = 95;
    knowledge.reports['warning'] = { ...near, position: { ...near.position, observedAt: 90 } };
    expect(nextDrill(own, knowledge, 100, map).drill?.kind).toBe('farAmbush');
  });

  it('reconsiders an active route attack when the reported force becomes too strong', () => {
    expect(nextDrill(self(), reported(100, 300), 100, map).drill?.kind).toBe('bypass');
    const noDetour = { ...map, routeMeters: (a: { x: number; y: number }, b: { x: number; y: number }, avoid: unknown) => distance(a, b) * (avoid === null ? 1 : 10) };
    expect(nextDrill(self(), reported(100, 300), 100, noDetour).drill?.kind).toBe('attack');
    expect(coordinateDrill(self(), reported(100, 300), drill, 100, noDetour).phase).toBe('establish');
  });

  it('uses announced suppression to resume a route mission even after an attack has begun', () => {
    const knowledge = { ...reported(), suppressions: { 'CAS-1': { aircraftId: 'CAS-1', center: target, radius: 100, fromTick: 90, untilTick: 120 } } };
    expect(nextDrill(self(), knowledge, 100, map).drill?.kind).toBe('pushThrough');
    expect(nextDrill(self(), knowledge, 130, map).drill?.kind).toBe('attack');
    const objective = { kind: 'AssaultArea' as const, area: { center: target, radius: 100 } };
    expect(nextDrill(self({ objective }), knowledge, 100, map).drill?.kind).toBe('attack');
  });

  it('corrects a route drill from a fresh local sighting without restarting it or changing an authored assault objective', () => {
    const local = { ...contact(), position: { ...contact().position, center: { x: 400, y: 0 } } };
    const knowledge = { ...emptyKnowledge(), contacts: { 'C-1': local } };
    const corrected = nextDrill(self(), knowledge, 100, map).drill;
    expect(corrected?.target).toEqual(local.position.center);
    expect(corrected?.startedAt).toBe(drill.startedAt);
    expect(corrected?.via).toEqual({ x: 400, y: 200 });
    const objective = { kind: 'AssaultArea' as const, area: { center: target, radius: 100 } };
    expect(nextDrill(self({ objective }), knowledge, 100, map).drill?.target).toEqual(target);
    const stale = { ...knowledge, contacts: { 'C-1': { ...local, position: { ...local.position, observedAt: 0 } } } };
    expect(nextDrill(self(), stale, 100, map).drill?.target).toEqual(target);
  });

  it('continues its route past a known enemy behind it, returning fire without turning back', () => {
    const own = self({ drill: null, position: { x: 600, y: 0 }, routeAhead: [target], underFire: true });
    expect(nextDrill({ ...own, underFire: false }, reported(), 100, map).drill).toBeNull();
    const nearby = { ...contact(), position: { ...contact().position, center: { x: 450, y: 0 } } };
    const knowledge = { ...emptyKnowledge(), contacts: { 'C-1': nearby } };
    const intent = decideGround(own, knowledge, 100, rates, map).intent;
    expect(intent.kind).toBe('engage');
    if (intent.kind !== 'engage') throw new Error('Expected return fire');
    expect(intent.closeTo?.x).toBeGreaterThan(own.position.x);
  });

  it.each(['withdrawing', 'searching'] as const)('%s retains return fire toward an unseen shooter', (kind) => {
    const own = self({ drill: null, underFire: true, mode: kind === 'withdrawing' ? 'withdrawing' : 'steady',
      ...(kind === 'searching' ? { objective: { kind: 'SearchArea' as const, area: { center: target, radius: 1000 } } } : {}) });
    const knowledge = emptyKnowledge();
    knowledge.fire.since = 95;
    knowledge.fire.from['bearing/0'] = { contact: null, bearingRad: 0, spreadRad: 0.2, origin: own.position, observedAt: 100 };
    const intent = decideGround(own, knowledge, 100, rates, map).intent;
    expect(intent.kind).toBe('engage');
    if (intent.kind !== 'engage') throw new Error('Expected return fire');
    expect(intent.closeTo === null).toBe(kind === 'searching');
  });

  it('gives equal-length hunter IDs distinct deterministic sweeps', () => {
    const own = self({ objective: { kind: 'SearchArea', area: { center: target, radius: 1000 } } });
    const a = search({ ...own, id: 'E-H1/1' as UnitId }, emptyKnowledge(), 100);
    const b = search({ ...own, id: 'E-H2/1' as UnitId }, emptyKnowledge(), 100);
    expect(a).not.toEqual(b);
    expect(a).toEqual(search({ ...own, id: 'E-H1/1' as UnitId }, emptyKnowledge(), 100));
  });
});

describe('ground decision knowledge boundary', () => {
  it('records supporting fire at an empty position without exposing any hit result', () => {
    const state = createInitialState(scenario, 7);
    const unit = state.truth.platoons['F-C1']?.squads[0];
    if (unit === undefined) throw new Error('Missing squad');
    for (const enemy of state.truth.units.filter((candidate) => candidate.side === 'enemy')) enemy.personnel = 0;
    const aim = { ...unit.position };
    unit.intent = { kind: 'engage', aim, closeTo: null, fireRate: 1, prepared: false };
    resolveCombat(state.truth, scenario.terrain, scenario.file.combat, state.rng, 10);
    const own = selfViews(state, scenario).platoons.get('F-C1');
    expect(own?.ownSquads.find((squad) => squad.id === unit.id)?.groundVolley).toEqual({ aim, at: 10 });
  });

  it('hidden changes to other formations cannot alter own status, roles, phase, or squad tactics', () => {
    const state = createInitialState(scenario, 7);
    const before = selfViews(state, scenario);
    const own = before.platoons.get('F-C1');
    if (own === undefined) throw new Error('Missing platoon');
    const knowledge = reported();
    const decide = (view: UnitSelf) => decidePlatoon({ ...view, drill }, knowledge, 100, map);
    const choice = decide(own);
    const tactics = before.squads.get('F-C1/1');
    if (tactics === undefined) throw new Error('Missing squad');
    const act = (view: UnitSelf) => decideGround({ ...view, drill, role: 'maneuver', drillPhase: choice.coordination?.phase ?? null }, knowledge, 100, rates, map);
    const intent = act(tactics);
    for (const enemy of state.truth.units.filter((unit) => unit.platoonId !== 'F-C1')) {
      enemy.position = { x: 1, y: 1 }; enemy.personnel = 0; enemy.suppression = 1; enemy.equipment = [];
      enemy.intent = { kind: 'move', destination: own.position }; enemy.route = [own.position];
    }
    state.truth.tracks = {};
    for (const enemy of Object.values(state.truth.platoons).filter((p) => p.id !== 'F-C1')) {
      enemy.morale = 0; enemy.drill = null; enemy.mode = 'broken';
    }
    const after = selfViews(state, scenario);
    expect(after.platoons.get('F-C1')).toEqual(own);
    expect(decide(after.platoons.get('F-C1') as UnitSelf)).toEqual(choice);
    expect(act(after.squads.get('F-C1/1') as UnitSelf)).toEqual(intent);
  });

  it('changed reports can halt maneuver without any change to enemy truth', () => {
    const own = self({ ownSquads: firing() });
    expect(coordinateDrill(own, reported(100, 10), drill, 100, map).phase).toBe('maneuver');
    expect(coordinateDrill(own, reported(100, 300), drill, 100, map).phase).toBe('establish');
  });
});
