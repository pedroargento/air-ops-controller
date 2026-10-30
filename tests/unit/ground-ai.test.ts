import { describe, expect, it } from 'vitest';
import { decideGround } from '../../src/ai/decide-ground';
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
};

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
  morale: 0.8,
  suppression: 0,
  mode: 'steady',
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
const decide = (unit: UnitSelf, knowledge: UnitKnowledge, tick = 0) => decideGround(unit, knowledge, tick);

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

    it('a patrol investigates a weaker reported force', () => {
      const intent = decide(patrol, report(300, 6)).intent;
      expect(intent).toEqual({ kind: 'move', destination: { x: 300, y: 0 } });
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

  it('cannot cycle forever: spent units break instead of returning', () => {
    const recovered = { mode: 'recovering', morale: 0.6 } as const;
    expect(decide(self({ ...recovered, returnsUsed: 1 }), nothing).mode).toBe('broken');
    expect(decide(self({ ...recovered, personnel: 10 }), nothing).mode).toBe('broken');
    expect(decide(self({ ...recovered, ammunition: 50 }), nothing).mode).toBe('broken');
    expect(decide(self({ mode: 'broken', morale: 1 }), nothing).mode).toBe('broken');
  });
});
