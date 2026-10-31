import { describe, expect, it } from 'vitest';
import { decideGround, type BehaviorFireRates } from '../../src/ai/decide-ground';
import type { ContactEstimate, Identification } from '../../src/domain/public/estimates';
import {
  emptyKnowledge,
  type ContactId,
  type Doctrine,
  type UnitId,
  type UnitKnowledge,
  type UnitSelf,
} from '../../src/domain/public/ground';

const doctrine: Doctrine = {
  speedMps: 1,
  detectRangeMeters: 500,
  observerQuality: 1,
  alertRadiusMeters: 500,
  avoidStrengthRatio: 1.5,
  delayStrengthRatio: 2,
  supportHoldBonus: 0.5,
  reportMemorySeconds: 300,
  airCoverSeconds: 30,
  airCoverRepeatSeconds: 300,
  engageRangeMeters: 300,
  closesToMeters: 40,
  pinnedSuppression: 0.7,
  withdrawCasualties: 0.5,
  withdrawMorale: 0.25,
  withdrawSuppression: 0.95,
  returnMorale: 0.55,
  returnSuppression: 0.25,
  returnMaxCasualties: 0.6,
  returnMinAmmoFraction: 0.1,
  maxReturns: 1,
  standoffMeters: 150,
  observeBias: 0.1,
  probeBias: 0.1,
  harassBias: 0.2,
  assaultBias: 1.5,
  burstSeconds: 120,
  pauseSeconds: 180,
  pressureMoraleFloor: 0.3,
  airFireThreshold: 0.02,
};

const rates: BehaviorFireRates = { observe: 0.5, probe: 0.6, harass: 0.35, assault: 1, disengage: 0.5 };

const self = (overrides: Partial<UnitSelf> = {}): UnitSelf => ({
  id: 'U' as UnitId,
  side: 'enemy',
  position: { x: 0, y: 0 },
  ownPosition: { center: { x: 5, y: 5 }, sigmaMeters: 40, headingRad: null, speedMps: null, observedAt: 0 },
  underFire: false,
  personnel: 40,
  initialPersonnel: 40,
  ammunition: 1000,
  initialAmmunition: 1000,
  equipment: [],
  supportWeapons: 3,
  airWeapons: [],
  morale: 0.8,
  suppression: 0,
  mode: 'steady',
  behavior: null,
  behaviorSinceTick: 0,
  groundCover: 0,
  returnsUsed: 0,
  patrolIndex: 0,
  objective: { kind: 'MoveTo', area: { center: { x: 1000, y: 0 }, radius: 40 } },
  fallback: { center: { x: -500, y: 0 }, radius: 100 },
  doctrine,
  ...overrides,
});

const estimate = (
  x: number,
  id = 'C-1',
  identification: Identification = 'hostile',
  men = 30,
): ContactEstimate => ({
  contactId: id as ContactId,
  provenance: { sourceId: 'OBSERVER', observedAt: 0 },
  identification,
  position: { center: { x, y: 0 }, sigmaMeters: 30, headingRad: null, speedMps: null, observedAt: 0 },
  strength: { kind: 'range', min: men, max: men },
  kind: 'infantry',
  activity: 'stationary',
  confidence: 'medium',
  observedWeapons: [],
});

const contact = (x: number, id = 'C-1'): UnitKnowledge => ({
  ...emptyKnowledge(),
  contacts: { [id]: estimate(x, id) },
});
const report = (x: number, men: number): UnitKnowledge => ({
  ...emptyKnowledge(),
  reports: { 'OTHER/C-9': estimate(x, 'C-9', 'hostile', men) },
});
const nothing: UnitKnowledge = emptyKnowledge();
const decide = (unit: UnitSelf, knowledge: UnitKnowledge, tick = 0) =>
  decideGround(unit, knowledge, tick, rates);

describe('decideGround', () => {
  it('applies the same rules to both sides', () => {
    for (const knowledge of [nothing, contact(100), contact(900)]) {
      expect(decide(self({ side: 'friendly' }), knowledge)).toEqual(
        decide(self({ side: 'enemy' }), knowledge),
      );
    }
  });

  it('pursues its objective when it knows of no enemy', () => {
    expect(decide(self(), nothing).intent).toEqual({ kind: 'move', destination: { x: 1000, y: 0 } });
  });

  it('holds defensively once inside the objective area', () => {
    const position = { x: 990, y: 0 };
    expect(decide(self({ position }), nothing).intent).toEqual({ kind: 'hold', posture: 'defending' });
  });

  it('engages known contacts in reach and ignores those out of reach', () => {
    expect(decide(self(), contact(100)).intent.kind).toBe('engage');
    expect(decide(self(), contact(800)).intent.kind).toBe('move');
  });

  it('closes on a target only while not pinned', () => {
    const closing = decide(self(), contact(200)).intent;
    const pinned = decide(self({ suppression: 0.8 }), contact(200)).intent;
    expect(closing).toMatchObject({ kind: 'engage', closeTo: { x: 200, y: 0 } });
    expect(pinned).toMatchObject({ kind: 'engage', closeTo: null });
  });

  it('goes prone when pinned with no target', () => {
    expect(decide(self({ suppression: 0.8 }), nothing).intent).toEqual({ kind: 'hold', posture: 'prone' });
  });

  it.each([
    ['casualties', { personnel: 20 }],
    ['morale', { morale: 0.2 }],
    ['suppression', { suppression: 0.96 }],
    ['ammunition', { ammunition: 0 }],
  ])('withdraws to its fallback on %s', (_name, overrides) => {
    const decision = decide(self(overrides), contact(100));
    expect(decision.mode).toBe('withdrawing');
    expect(decision.intent).toEqual({ kind: 'move', destination: { x: -500, y: 0 } });
  });

  it('starts recovering on reaching the fallback', () => {
    const decision = decide(self({ mode: 'withdrawing', position: { x: -500, y: 0 } }), nothing);
    expect(decision.mode).toBe('recovering');
  });

  it('returns once recovered and counts the return', () => {
    const decision = decide(self({ mode: 'recovering', personnel: 30, morale: 0.6 }), nothing);
    expect(decision.mode).toBe('steady');
    expect(decision.returnsUsed).toBe(1);
  });

  it('does not fire on an unidentified contact or on a report it cannot see itself', () => {
    const unidentified = { ...emptyKnowledge(), contacts: { 'C-1': estimate(100, 'C-1', 'unidentified') } };
    expect(decide(self(), unidentified).intent.kind).toBe('move');
    expect(decide(self(), report(100, 30)).intent.kind).toBe('move');
  });

  it('ignores a contact it has not seen recently', () => {
    expect(decide(self(), contact(100), 500).intent.kind).toBe('move');
  });

  it('goes to ground when it has noticed hostile aircraft, but keeps fighting if engaged', () => {
    const seen = { ...emptyKnowledge(), hostileAircraftSeenAt: 90 };
    expect(decide(self(), seen, 100).intent).toEqual({ kind: 'hold', posture: 'prone' });
    expect(decide(self(), seen, 130).intent.kind).toBe('move');
    const engaged = { ...contact(100), hostileAircraftSeenAt: 90 };
    expect(decide(self(), { ...engaged, contacts: {} }, 100).intent.kind).toBe('hold');
  });

  describe('responding to received information', () => {
    const area = { center: { x: 0, y: 0 }, radius: 100 };
    const hold = self({ objective: { kind: 'HoldArea', area } });
    const patrol = self({
      personnel: 12,
      initialPersonnel: 12,
      objective: { kind: 'PatrolArea', waypoints: [{ x: 1000, y: 0 }] },
    });

    it('a holding unit repositions within its area toward a reported threat', () => {
      const intent = decide(hold, report(400, 30)).intent;
      expect(intent).toEqual({ kind: 'move', destination: { x: 70, y: 0 } });
    });

    it('a patrol avoids a much stronger reported force', () => {
      const intent = decide(patrol, report(300, 40)).intent;
      expect(intent).toEqual({ kind: 'move', destination: { x: -500, y: 0 } });
    });

    it('a patrol investigates a weaker reported force, stopping at standoff', () => {
      const intent = decide(patrol, report(300, 6)).intent;
      expect(intent).toEqual({ kind: 'move', destination: { x: 150, y: 0 } });
      const near = self({ ...patrol, position: { x: 200, y: 0 } });
      expect(decide(near, report(300, 6)).intent).toEqual({ kind: 'hold', posture: 'prone' });
    });

    it('a warned patrol that has reached its fallback stays and reinforces it', () => {
      const back = self({ ...patrol, position: { x: -500, y: 0 } });
      expect(decide(back, report(-300, 40)).intent).toEqual({ kind: 'hold', posture: 'defending' });
    });

    it('a holding unit told what is coming fights from prepared positions', () => {
      const unit = self({ objective: { kind: 'HoldArea', area } });
      const warned = { ...contact(200), reports: report(250, 80).reports };
      expect(decide(unit, contact(200)).intent).toMatchObject({ kind: 'engage', prepared: false });
      expect(decide(unit, warned).intent).toMatchObject({ kind: 'engage', prepared: true });
    });

    it('an advancing unit delays for a much stronger force on its route', () => {
      expect(decide(self(), report(300, 100)).intent).toEqual({ kind: 'hold', posture: 'prone' });
      expect(decide(self(), report(300, 30)).intent.kind).toBe('move');
    });

    it('a withdrawing unit changes its route when a report puts the enemy at its fallback', () => {
      const withdrawing = self({ mode: 'withdrawing', position: { x: 1000, y: 0 } });
      const clear = decide(withdrawing, nothing).intent;
      const threatened = decide(withdrawing, report(-300, 30)).intent;
      expect(clear).toEqual({ kind: 'move', destination: { x: -500, y: 0 } });
      expect(threatened).toEqual({ kind: 'move', destination: { x: -590, y: 0 } });
    });

    it('ignores stale reports', () => {
      expect(decide(patrol, report(300, 40), 1000).intent).toEqual({
        kind: 'move',
        destination: { x: 1000, y: 0 },
      });
    });

    it('a unit expecting air support holds out longer, until the expectation lapses', () => {
      const shaken = self({ morale: 0.2 });
      const support = { aircraftId: 'CAS-1', etaAt: 100, lapsesAt: 200 };
      const expecting = { ...emptyKnowledge(), expectedSupport: support };
      expect(decide(shaken, nothing).mode).toBe('withdrawing');
      expect(decide(shaken, expecting, 100).mode).toBe('steady');
      expect(decide(shaken, expecting, 201).mode).toBe('withdrawing');
    });
  });

  describe('firing on aircraft', () => {
    const manpads = {
      weapon: 'MANPADS' as const,
      count: 1,
      definition: {
        targetDomains: ['AIR' as const],
        rangeMeters: 2500,
        suppressionEffect: 0,
        damageEffect: 0,
        crewRequired: 2,
        ammunitionPerUse: 1,
        maxAltitudeMeters: 2500,
        airHitChance: 0.3,
        airCycleSeconds: 90,
      },
    };
    const overhead = (tick: number, altitudeMeters = 300) => ({
      ...emptyKnowledge(),
      noticedAircraft: { position: { x: 100, y: 0 }, altitudeMeters, seenAt: tick },
    });

    it('fires when its weapon can reach a noticed aircraft', () => {
      expect(decide(self({ airWeapons: [manpads] }), overhead(10), 10).firesAtAircraft).toBe(true);
    });

    it('stays concealed with no useful weapon, whatever its doctrine', () => {
      expect(decide(self(), overhead(10), 10).firesAtAircraft).toBe(false);
    });

    it('stays concealed when the shot is not worth giving away its position', () => {
      const cautious = { ...doctrine, airFireThreshold: 0.9 };
      expect(decide(self({ doctrine: cautious, airWeapons: [manpads] }), overhead(10), 10).firesAtAircraft).toBe(false);
    });

    it('holds fire above the weapon\'s altitude, or once the aircraft is out of mind', () => {
      const unit = self({ airWeapons: [manpads] });
      expect(decide(unit, overhead(10, 3000), 10).firesAtAircraft).toBe(false);
      expect(decide(unit, overhead(10), 100).firesAtAircraft).toBe(false);
    });

    it('applies the same rule to both sides, and a broken unit does not fire', () => {
      const unit = self({ airWeapons: [manpads] });
      expect(decide({ ...unit, side: 'friendly' }, overhead(10), 10).firesAtAircraft).toBe(true);
      expect(decide({ ...unit, mode: 'broken' }, overhead(10), 10).firesAtAircraft).toBe(false);
    });
  });

  describe('tactical behaviors', () => {
    const screening: Doctrine = { ...doctrine, observeBias: 1, probeBias: 0, harassBias: 0.1, assaultBias: 0.1, standoffMeters: 300 };
    const screen = (overrides: Partial<UnitSelf> = {}): UnitSelf =>
      self({
        doctrine: screening,
        personnel: 12,
        initialPersonnel: 12,
        objective: { kind: 'PatrolArea', waypoints: [{ x: 1000, y: 0 }] },
        ...overrides,
      });
    const harasser: Doctrine = { ...doctrine, observeBias: 0, probeBias: 0, harassBias: 1, assaultBias: 0, closesToMeters: null };
    const pinned = (overrides: Partial<UnitSelf>): UnitSelf => self({ doctrine: harasser, ...overrides });

    it('does not treat contact as a fight: a screen observes and holds fire', () => {
      const decision = decide(screen(), contact(400));
      expect(decision.behavior).toBe('observe');
      expect(decision.intent).toEqual({ kind: 'hold', posture: 'prone' });
    });

    it('a screen pulls back when the enemy closes inside its standoff', () => {
      const decision = decide(screen(), contact(200));
      expect(decision.behavior).toBe('observe');
      expect(decision.intent).toEqual({ kind: 'move', destination: { x: -300, y: 0 } });
    });

    it('a screen fired on returns fire while it breaks contact', () => {
      const intent = decide(screen({ underFire: true }), contact(200)).intent;
      expect(intent).toMatchObject({ kind: 'engage', fireRate: rates.observe, closeTo: { x: -300, y: 0 } });
    });

    it('an assault commits at full rate and keeps closing', () => {
      const decision = decide(self(), contact(200));
      expect(decision.behavior).toBe('assault');
      expect(decision.intent).toMatchObject({ kind: 'engage', fireRate: 1, closeTo: { x: 200, y: 0 } });
      const held = decide(self({ behavior: 'assault', behaviorSinceTick: 0 }), contact(200), 1000 % 20);
      expect(held.behavior).toBe('assault');
    });

    it('harassment fires at a reduced rate, in bursts separated by pauses', () => {
      const first = decide(pinned({}), contact(200), 0);
      expect(first.behavior).toBe('harass');
      expect(first.intent).toMatchObject({ kind: 'engage', fireRate: rates.harass, closeTo: null });
      const burst = pinned({ behavior: 'harass', behaviorSinceTick: 0 });
      expect(decide(burst, contact(200), 15).behavior).toBe('harass');
      const after = { ...contact(200), contacts: { 'C-1': { ...estimate(200), position: { ...estimate(200).position, observedAt: 120 } } } };
      const paused = decide(burst, after, 125);
      expect(paused.behavior).toBe('observe');
      expect(paused.behaviorSinceTick).toBe(125);
      const resting = pinned({ behavior: 'observe', behaviorSinceTick: 125 });
      expect(decide(resting, after, 130).behavior).toBe('observe');
    });

    it('moves into range before opening a probe or harassment', () => {
      expect(decide(pinned({}), contact(450)).intent).toMatchObject({ kind: 'engage', closeTo: { x: 450, y: 0 } });
    });

    it('fears a stronger enemy: outnumbered units stop choosing assault', () => {
      const cautious = { ...doctrine, harassBias: 0.5, assaultBias: 0.8 };
      const unit = self({ doctrine: cautious, personnel: 20, initialPersonnel: 20 });
      const weak = { ...emptyKnowledge(), contacts: { 'C-1': estimate(200, 'C-1', 'hostile', 10) } };
      const strong = { ...emptyKnowledge(), contacts: { 'C-1': estimate(200, 'C-1', 'hostile', 80) } };
      expect(decide(unit, weak).behavior).toBe('assault');
      expect(decide(unit, strong).behavior).toBe('harass');
    });

    it('a report changes the behavior it chooses but never its objective', () => {
      const cautious = { ...doctrine, harassBias: 0.5, assaultBias: 0.8 };
      const unit = self({ doctrine: cautious, personnel: 20, initialPersonnel: 20 });
      const weak = { ...emptyKnowledge(), contacts: { 'C-1': estimate(200, 'C-1', 'hostile', 10) } };
      const told = { ...weak, reports: report(250, 80).reports };
      expect(decide(unit, weak).behavior).toBe('assault');
      expect(decide(unit, told).behavior).toBe('harass');
      expect(decide(unit, told)).not.toHaveProperty('objective');
    });

    it('real expected support makes a unit readier to commit, until it lapses', () => {
      const cautious = { ...doctrine, harassBias: 0.5, assaultBias: 0.42 };
      const unit = self({ doctrine: cautious });
      const support = { aircraftId: 'CAS-1', etaAt: 10, lapsesAt: 20 };
      const expecting = { ...contact(200), expectedSupport: support };
      expect(decide(unit, contact(200)).behavior).toBe('harass');
      expect(decide(unit, expecting, 15).behavior).toBe('assault');
    });

    it('prefers harassing from good cover', () => {
      const even = { ...doctrine, harassBias: 0.4, assaultBias: 0.5 };
      expect(decide(self({ doctrine: even }), contact(200)).behavior).toBe('assault');
      expect(decide(self({ doctrine: even, groundCover: 0.5 }), contact(200)).behavior).toBe('harass');
    });

    it('a screen stands and fights at the fallback it came back to', () => {
      const back = screen({ position: { x: -500, y: 0 } });
      expect(decide(back, contact(-400)).behavior).toBe('assault');
      expect(decide(back, contact(-400)).intent.kind).toBe('engage');
    });

    it('a unit with no heavy weapons is less inclined to assault', () => {
      const balanced = { ...doctrine, harassBias: 0.4, assaultBias: 0.5 };
      expect(decide(self({ doctrine: balanced }), contact(200)).behavior).toBe('assault');
      expect(decide(self({ doctrine: balanced, supportWeapons: 0 }), contact(200)).behavior).toBe('harass');
    });

    it('a holding unit has to defend an enemy on its position', () => {
      const area = { center: { x: 0, y: 0 }, radius: 100 };
      const unit = pinned({ objective: { kind: 'HoldArea', area } });
      expect(decide(unit, contact(200)).behavior).toBe('assault');
      expect(decide(unit, contact(300)).behavior).toBe('harass');
    });

    it('a withdrawing or recovering unit only returns fire', () => {
      const under = { underFire: true, morale: 0.2 };
      expect(decide(self({ ...under, mode: 'withdrawing' }), contact(200)).intent).toMatchObject({
        kind: 'engage',
        fireRate: rates.disengage,
        closeTo: { x: -500, y: 0 },
      });
      expect(decide(self({ morale: 0.2, mode: 'withdrawing' }), contact(200)).intent.kind).toBe('move');
      const holding = self({ ...under, mode: 'recovering', position: { x: -500, y: 0 } });
      expect(decide(holding, contact(-400)).intent).toMatchObject({ kind: 'engage', closeTo: null });
    });

    it('noticing aircraft interrupts an assault without stopping its fire', () => {
      const seen = { ...contact(200), hostileAircraftSeenAt: 0 };
      expect(decide(self(), seen, 5).intent).toMatchObject({ kind: 'engage', closeTo: null });
    });
  });

  it('cannot cycle forever: spent units break instead of returning', () => {
    const recovered = { mode: 'recovering', morale: 0.6 } as const;
    expect(decide(self({ ...recovered, returnsUsed: 1 }), nothing).mode).toBe('broken');
    expect(decide(self({ ...recovered, personnel: 10 }), nothing).mode).toBe('broken');
    expect(decide(self({ ...recovered, ammunition: 50 }), nothing).mode).toBe('broken');
    expect(decide(self({ mode: 'broken', morale: 1 }), nothing).mode).toBe('broken');
  });
});
