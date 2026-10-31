import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import { airHitChance, airWeapons, isAntiAir, supportWeaponCount, threatRadiusMeters, totalAmmunition, usableWeapons, type Equipment } from '../../src/domain/public/equipment';
import { altitudeFraction, ceilingLabel, groundFireText, shortAircraftName, snappedAltitude, weaponsText, weaponTag } from '../../src/ui/format';

const { weapons } = loadScenarioFile().file.combat;
const rifles: Equipment = { weapon: 'SMALL_ARMS', quantity: 10, ammunition: 1000 };
const guns: Equipment = { weapon: 'MACHINE_GUN', quantity: 2, ammunition: 500 };

describe('usable weapons', () => {
  it('crews specialist weapons first and arms everyone else with small arms', () => {
    expect(usableWeapons([rifles, guns], 10, weapons)).toEqual([
      { weapon: 'MACHINE_GUN', count: 2 },
      { weapon: 'SMALL_ARMS', count: 6 },
    ]);
  });

  it('leaves a gun silent when there is no crew for it', () => {
    expect(usableWeapons([rifles, guns], 3, weapons)).toEqual([
      { weapon: 'MACHINE_GUN', count: 1 },
      { weapon: 'SMALL_ARMS', count: 1 },
    ]);
    expect(usableWeapons([guns], 1, weapons)).toEqual([]);
  });

  it('crews rejoin the riflemen when their gun has no ammunition', () => {
    const empty = { ...guns, ammunition: 0 };
    expect(usableWeapons([rifles, empty], 10, weapons)).toEqual([{ weapon: 'SMALL_ARMS', count: 10 }]);
  });

  it('counts only crew-served ground weapons as support', () => {
    const team: Equipment = { weapon: 'MANPADS', quantity: 1, ammunition: 3 };
    expect(supportWeaponCount([rifles, guns, team], 10, weapons)).toBe(2);
    expect(supportWeaponCount([rifles, team], 10, weapons)).toBe(0);
  });

  it('adds ammunition across the whole inventory', () => {
    expect(totalAmmunition([rifles, guns])).toBe(1500);
  });
});

describe('air hit chance', () => {
  const missile = airWeapons([{ weapon: 'MANPADS', quantity: 1, ammunition: 3 }], 3, weapons)[0];
  if (missile === undefined) throw new Error('no anti-aircraft weapon');
  const { maxAltitudeMeters, rangeMeters } = missile.definition;

  it('falls with altitude and reaches zero above the maximum', () => {
    expect(airHitChance(missile, 500, 100)).toBeGreaterThan(airHitChance(missile, 500, 400));
    expect(airHitChance(missile, 100, maxAltitudeMeters + 1)).toBe(0);
  });

  it('falls with distance and is zero beyond three-dimensional range', () => {
    expect(airHitChance(missile, 500, 300)).toBeGreaterThan(airHitChance(missile, 1500, 300));
    expect(airHitChance(missile, rangeMeters + 1, 300)).toBe(0);
  });

  it('needs a crew', () => {
    expect(airWeapons([{ weapon: 'MANPADS', quantity: 1, ammunition: 3 }], 1, weapons)).toEqual([]);
  });

  it('small arms cannot reach the operating altitude; machine guns barely can', () => {
    const { operatingAltitudeMeters: altitude } = loadScenarioFile().file.air;
    const rifles = airWeapons([{ weapon: 'SMALL_ARMS', quantity: 40, ammunition: 100 }], 40, weapons)[0];
    const gun = airWeapons([{ weapon: 'MACHINE_GUN', quantity: 1, ammunition: 100 }], 2, weapons)[0];
    if (rifles === undefined || gun === undefined) throw new Error('missing weapons');
    expect(airHitChance(rifles, altitude, altitude)).toBe(0);
    expect(airHitChance(gun, altitude, altitude)).toBeLessThan(0.01);
  });
});

describe('scenario equipment', () => {
  it('gives every weapon a crew and a target domain', () => {
    for (const definition of Object.values(weapons)) {
      expect(definition.crewRequired).toBeGreaterThan(0);
      expect(definition.targetDomains.length).toBeGreaterThan(0);
    }
  });

  it('gives only ground-capable weapons a ground effect', () => {
    expect(weapons.MANPADS.targetDomains).toEqual(['AIR']);
    expect(weapons.MANPADS.damageEffect).toBe(0);
  });
});

describe('threat radius', () => {
  const altitude = 300;

  it('is well inside the weapon\'s full range', () => {
    const radius = threatRadiusMeters(weapons.MANPADS, altitude, 0.1);
    expect(radius).toBeGreaterThan(500);
    expect(radius).toBeLessThan(weapons.MANPADS.rangeMeters * 0.6);
  });

  it('treats slow and fast firers fairly, by risk per minute', () => {
    expect(threatRadiusMeters(weapons.AAA, altitude, 0.1)).toBeGreaterThan(500);
  });

  it('shrinks as the accepted risk rises, and vanishes above the weapon\'s ceiling', () => {
    expect(threatRadiusMeters(weapons.MANPADS, altitude, 0.15)).toBeLessThan(threatRadiusMeters(weapons.MANPADS, altitude, 0.1));
    expect(threatRadiusMeters(weapons.MANPADS, weapons.MANPADS.maxAltitudeMeters + 1, 0.1)).toBe(0);
    expect(threatRadiusMeters(weapons.SMALL_ARMS, altitude, 0.1)).toBe(0);
  });
});

describe('weapon tags', () => {
  it('stays plain for nothing or small arms, which nearly everyone has', () => {
    expect(weaponTag([])).toBeNull();
    expect(weaponTag(['SMALL_ARMS'])).toBeNull();
  });

  it('puts anti-air first', () => {
    expect(weaponTag(['MACHINE_GUN', 'MANPADS', 'SMALL_ARMS'])).toBe('MP MG');
    expect(weaponTag(['AAA'])).toBe('AAA');
    expect(weaponTag(['MACHINE_GUN'])).toBe('MG');
  });

  it('knows which weapons threaten aircraft', () => {
    expect(['AAA', 'MANPADS', 'MACHINE_GUN', 'SMALL_ARMS'].map((w) => isAntiAir(w as never))).toEqual([true, true, false, false]);
  });
});

describe('ground fire tooltip', () => {
  const fire = { aircraftId: 'CAS-1', position: { x: 2525, y: 2625 }, ageSeconds: 300, hit: true, weapon: null, opacity: 1 };

  it('calls the position an estimate and says when the weapon was not seen', () => {
    const text = groundFireText(fire, 50);
    expect(text).toContain('aircraft hit');
    expect(text).toContain('Weapon not seen');
    expect(text).toContain('Estimated source, grid 050-052');
    expect(groundFireText({ ...fire, weapon: 'MANPADS' }, 50)).toContain('Weapon: MANPADS');
  });
});

describe('altitude profile scale', () => {
  it('opens up the low altitudes, where the detail is', () => {
    expect(altitudeFraction(0, 3000)).toBe(0);
    expect(altitudeFraction(3000, 3000)).toBe(1);
    expect(altitudeFraction(300, 3000)).toBeGreaterThan(0.25);
  });

  it('turns a drag back into a 100 m step, inside the scale', () => {
    expect(snappedAltitude(altitudeFraction(1234, 3000), 3000)).toBe(1200);
    expect(snappedAltitude(2, 3000)).toBe(3000);
    expect(snappedAltitude(-1, 3000)).toBe(0);
  });

  it('shortens aircraft names for narrow columns', () => {
    expect(shortAircraftName('RECON-1')).toBe('R1');
    expect(shortAircraftName('CAS-12')).toBe('C12');
  });

  it('labels every weapon, including small arms', () => {
    expect(ceilingLabel('SMALL_ARMS')).toBe('SA');
    expect(ceilingLabel('MANPADS')).toBe('MP');
  });
});

describe('weapons text', () => {
  it('says so when nothing has been observed', () => {
    expect(weaponsText([])).toBe('Weapons not observed');
    expect(weaponsText(['MACHINE_GUN', 'AAA'])).toBe('Weapons seen: machine guns, AAA');
  });
});
