import { describe, expect, it } from 'vitest';
import { chooseAttack, chooseStrike, chooseSuppression, decideCrew } from '../../src/ai/decide-crew';
import type { CrewSelf, FiredOn, WeaponsControl } from '../../src/domain/public/air';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import type { ContactId } from '../../src/domain/public/ground';
import type { Weather } from '../../src/domain/public/weather';

const crew = (overrides: Partial<CrewSelf> = {}): CrewSelf => ({
  tick: 1000,
  role: 'cas',
  rotary: false,
  status: 'onStation',
  order: { kind: 'Watch', center: { x: 0, y: 0 }, radius: 500 },
  destination: { x: 0, y: 0 },
  position: { x: 0, y: 0 },
  risk: 'normal',
  weapons: 'both',
  manualAltitude: false,
  defaultAltitudeMeters: 650,
  minAltitudeMeters: 100,
  maxAltitudeMeters: 3000,
  ammunition: 8,
  gunBursts: 20,
  gunsReachable: true,
  enduranceSeconds: 3000,
  passIntervalSeconds: 120,
  gunPassFactor: 0.4,
  firedOn: [],
  contacts: [],
  forecast: null,
  weaponCeilings: { SMALL_ARMS: 150, MACHINE_GUN: 350, AAA: 2000, MANPADS: 2500 },
  threatMemorySeconds: 900,
  breakReactionSeconds: 10,
  searchLeg: 0,
  searchPoint: null,
  attackRun: null,
  tuning: { cloudMarginMeters: 80, rainSightShare: 0.7, threatStandoffMeters: 900, searchReachedMeters: 300, searchLegs: 6, searchRingShare: 0.65, suppressSpreadShare: 0.5 },
  ...overrides,
});

const fired = (overrides: Partial<FiredOn> = {}): FiredOn => ({ center: { x: 100, y: 0 }, tick: 995, weapon: null, hit: false, ...overrides });

const contact = (id: string, x: number, overrides: Partial<ContactEstimate> = {}): ContactEstimate => ({
  contactId: id as ContactId,
  provenance: { sourceId: 'CAS-1', observedAt: 990 },
  identification: 'hostile',
  position: { center: { x, y: 0 }, sigmaMeters: 30, headingRad: null, speedMps: null, observedAt: 990 },
  strength: { kind: 'range', min: 6, max: 14 },
  kind: 'infantry',
  activity: 'stationary',
  confidence: 'medium',
  observedWeapons: [],
  ...overrides,
});

describe('crew altitude', () => {
  it('leaves a hand-set altitude alone', () => {
    expect(decideCrew(crew({ manualAltitude: true })).altitudeMeters).toBeNull();
  });

  it('works at its normal height, and transits low in a strike aircraft', () => {
    expect(decideCrew(crew()).altitudeMeters).toBe(650);
    expect(decideCrew(crew({ status: 'enroute' })).altitudeMeters).toBe(100);
    expect(decideCrew(crew({ status: 'enroute', risk: 'cautious' })).altitudeMeters).toBe(650);
  });

  it('comes down under a forecast cloud base', () => {
    const forecast = {
      baseCeilingMeters: 400, systems: [], clearVisibilityMeters: 8000, minRainVisibilityMeters: 300, rainMissMeters: 0,
    } as unknown as Weather;
    const altitude = decideCrew(crew({ forecast })).altitudeMeters;
    expect(altitude).toBeLessThan(400);
  });

  it('takes recon up once shot at, unless told to press on', () => {
    const shot = { role: 'recon', firedOn: [fired({ weapon: 'MACHINE_GUN' })] } as const;
    expect(decideCrew(crew(shot)).altitudeMeters).toBe(650);
    const higher = { role: 'recon', firedOn: [fired({ weapon: 'AAA' })] } as const;
    expect(decideCrew(crew(higher)).altitudeMeters).toBe(2080);
    expect(decideCrew(crew({ ...higher, risk: 'pressOn' })).altitudeMeters).toBe(650);
  });

  it('stays above known weapons when cautious', () => {
    const contacts = [contact('C-1', 100, { observedWeapons: ['AAA'] })];
    expect(decideCrew(crew({ contacts, risk: 'cautious' })).altitudeMeters).toBe(2080);
    expect(decideCrew(crew({ contacts })).altitudeMeters).toBe(650);
  });

  it('flies a gun run at the run\'s height', () => {
    const attackRun = { aim: { x: 0, y: 0 }, contactId: 'C-1', weapon: 'guns', phase: 'runIn', releaseAltitudeMeters: 200, pullOffSeconds: 5, nextPassSeconds: 120 } as const;
    expect(decideCrew(crew({ attackRun })).altitudeMeters).toBe(200);
  });
});

describe('breaking off', () => {
  it('depends on the risk limit', () => {
    const smallArms = [fired()];
    expect(decideCrew(crew({ firedOn: smallArms, risk: 'cautious' })).breakFrom).toEqual({ x: 100, y: 0 });
    expect(decideCrew(crew({ firedOn: smallArms })).breakFrom).toBeNull();
    const hit = [fired({ hit: true })];
    expect(decideCrew(crew({ firedOn: hit })).breakFrom).toEqual({ x: 100, y: 0 });
    expect(decideCrew(crew({ firedOn: hit, risk: 'pressOn' })).breakFrom).toBeNull();
  });

  it('reacts to fresh fire only, and not in the middle of a run', () => {
    expect(decideCrew(crew({ firedOn: [fired({ hit: true, tick: 900 })] })).breakFrom).toBeNull();
    const attackRun = { aim: { x: 0, y: 0 }, contactId: 'C-1', weapon: 'heavy', phase: 'runIn', releaseAltitudeMeters: 650, pullOffSeconds: 5, nextPassSeconds: 120 } as const;
    expect(decideCrew(crew({ firedOn: [fired({ hit: true })], attackRun })).breakFrom).toBeNull();
  });
});

describe('choosing an attack', () => {
  const lone = contact('C-1', 100);

  it('uses heavy ordnance first, and guns once it has run out', () => {
    expect(chooseAttack(crew(), [lone])?.weapon).toBe('heavy');
    expect(chooseAttack(crew({ ammunition: 0 }), [lone])?.weapon).toBe('guns');
    expect(chooseAttack(crew({ ammunition: 0, gunBursts: 0 }), [lone])).toBeNull();
  });

  it('works closer to friends with guns than with bombs', () => {
    const tooCloseForBombs = (_: ContactEstimate, weapon: 'heavy' | 'guns') => weapon === 'heavy';
    expect(chooseAttack(crew(), [lone], tooCloseForBombs)?.weapon).toBe('guns');
    expect(chooseAttack(crew({ gunsReachable: false }), [lone], tooCloseForBombs)).toBeNull();
    expect(chooseAttack(crew(), [lone], () => true)).toBeNull();
  });

  it('stays off a place it was hit from, unless told to press on', () => {
    const hit = [fired({ hit: true })];
    expect(chooseAttack(crew({ firedOn: hit }), [lone])).toBeNull();
    expect(chooseAttack(crew({ firedOn: hit, risk: 'pressOn' }), [lone])).not.toBeNull();
  });

  it('treats small arms as the job, unless cautious', () => {
    const shot = [fired()];
    expect(chooseAttack(crew({ firedOn: shot }), [lone])).not.toBeNull();
    expect(chooseAttack(crew({ firedOn: shot, risk: 'cautious' }), [lone])).toBeNull();
  });

  it('puts known air defense first, wherever the fire came from', () => {
    const team = contact('C-9', 300, { observedWeapons: ['MANPADS'] });
    expect(chooseAttack(crew({ firedOn: [fired({ hit: true })] }), [lone, team])?.contact).toBe(team);
  });
});

describe('search', () => {
  const order = { kind: 'Watch', center: { x: 0, y: 0 }, radius: 1000 } as const;
  const recon = (overrides: Partial<CrewSelf> = {}): CrewSelf => crew({ role: 'recon', order, position: { x: 5000, y: 5000 }, ...overrides });

  it('moves on to the next leg once it has reached one', () => {
    expect(decideCrew(recon()).searchLeg).toBe(0);
    const arrived = decideCrew(recon({ position: { x: 0, y: 0 } }));
    expect(arrived.searchLeg).toBe(1);
    expect(arrived.searchPoint).not.toEqual(order.center);
  });

  it('goes back to look again at a contact it can\'t identify', () => {
    const doubtful = contact('C-1', 400, { identification: 'unidentified' });
    expect(decideCrew(recon({ contacts: [doubtful] })).searchPoint).toEqual(doubtful.position.center);
  });

  it('applies only to a recon mission on station', () => {
    expect(decideCrew(crew()).searchPoint).toBeNull();
    expect(decideCrew(recon({ status: 'enroute' })).searchPoint).toBeNull();
  });
});

describe('weapons control', () => {
  const lone = contact('C-1', 100);
  const support = (weapons: WeaponsControl): Partial<CrewSelf> => ({ weapons });

  it('keeps to bombs or guns when told to', () => {
    expect(chooseAttack(crew(support('guns')), [lone])?.weapon).toBe('guns');
    expect(chooseAttack(crew({ ...support('heavy'), ammunition: 0 }), [lone])).toBeNull();
    expect(chooseAttack(crew(support('both')), [lone])?.weapon).toBe('heavy');
  });

  it('spreads its bursts over its time on station to keep a position down', () => {
    const paced = chooseAttack(crew({ ...support('guns'), gunBursts: 20, enduranceSeconds: 3000 }), [lone]);
    expect(paced?.nextPassSeconds).toBe(150);
    const fast = chooseAttack(crew({ ammunition: 0, gunBursts: 20 }), [lone]);
    expect(fast?.nextPassSeconds).toBe(48);
  });

  it('never waits longer than two bomb passes between bursts', () => {
    expect(chooseAttack(crew({ ...support('guns'), gunBursts: 2, enduranceSeconds: 9000 }), [lone])?.nextPassSeconds).toBe(240);
  });
});

describe('fire on a place', () => {
  const suppress = { kind: 'Suppress', center: { x: 0, y: 0 }, radius: 200, untilTick: 1600 } as const;

  it('picks no targets of its own on weapons hold', () => {
    expect(chooseAttack(crew({ weapons: 'hold' }), [contact('C-1', 100)])).toBeNull();
  });

  it('spreads its bursts to last the window', () => {
    const pass = chooseSuppression(crew({ gunBursts: 10 }), suppress);
    expect(pass !== null && pass !== 'done' ? pass.nextPassSeconds : null).toBe(60);
    const short = chooseSuppression(crew({ gunBursts: 10 }), { ...suppress, untilTick: 1100 });
    expect(short !== null && short !== 'done' ? short.nextPassSeconds : null).toBe(48);
  });

  it('is done once the window closes or the guns are empty', () => {
    expect(chooseSuppression(crew({ tick: 1601 }), suppress)).toBe('done');
    expect(chooseSuppression(crew({ gunBursts: 0 }), suppress)).toBe('done');
  });

  it('walks its fire across the area, away from friends', () => {
    const aims = [20, 19, 18, 17].map((left) => {
      const pass = chooseSuppression(crew({ gunBursts: left }), suppress);
      return pass !== null && pass !== 'done' ? pass.aim : null;
    });
    expect(new Set(aims.map((aim) => JSON.stringify(aim))).size).toBeGreaterThan(1);
    const eastIsFriendly = (point: { x: number }): boolean => point.x > 10;
    for (const left of [20, 19, 18, 17]) {
      const pass = chooseSuppression(crew({ gunBursts: left }), suppress, eastIsFriendly);
      expect(pass !== null && pass !== 'done' ? pass.aim.x : null).toBeLessThanOrEqual(10);
    }
  });

  it('holds when there is nowhere clear of friends to aim', () => {
    expect(chooseSuppression(crew(), suppress, () => true)).toBeNull();
  });

  it('stays off a place it was seriously fired on, unless told to press on', () => {
    const shot = [fired({ center: { x: 50, y: 0 }, hit: true })];
    expect(chooseSuppression(crew({ firedOn: shot }), suppress)).toBeNull();
    expect(chooseSuppression(crew({ firedOn: shot, risk: 'pressOn' }), suppress)).not.toBeNull();
  });

  it('strikes once with bombs, and is done without them', () => {
    const strike = { kind: 'Strike', center: { x: 0, y: 0 }, radius: 300 } as const;
    const pass = chooseStrike(crew(), strike);
    expect(pass !== null && pass !== 'done' ? pass.weapon : null).toBe('heavy');
    expect(chooseStrike(crew({ ammunition: 0 }), strike)).toBe('done');
  });
});
