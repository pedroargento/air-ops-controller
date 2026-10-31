export type WeaponType = 'SMALL_ARMS' | 'MACHINE_GUN' | 'AAA' | 'MANPADS';
export type TargetDomain = 'GROUND' | 'AIR';

/** What a weapon can do. What a unit actually has is its `Equipment`. */
export type WeaponDefinition = Readonly<{
  targetDomains: readonly TargetDomain[];
  rangeMeters: number;
  suppressionEffect: number;
  damageEffect: number;
  crewRequired: number;
  ammunitionPerUse: number;
  maxAltitudeMeters: number;
  airHitChance: number;
  airCycleSeconds: number;
}>;

export type WeaponTable = Readonly<Record<WeaponType, WeaponDefinition>>;

export type Equipment = Readonly<{ weapon: WeaponType; quantity: number; ammunition: number }>;

export type WeaponFire = Readonly<{ weapon: WeaponType; count: number }>;

export function totalAmmunition(equipment: readonly Equipment[]): number {
  return equipment.reduce((sum, item) => sum + item.ammunition, 0);
}

/**
 * What can fire now. Crew go to specialist weapons that still have ammunition, and
 * everyone else uses small arms, so a unit that loses a gun keeps its crew as riflemen.
 */
export function usableWeapons(
  equipment: readonly Equipment[],
  personnel: number,
  weapons: WeaponTable,
): readonly WeaponFire[] {
  const usable: WeaponFire[] = [];
  let free = personnel;
  for (const item of equipment) {
    if (item.weapon === 'SMALL_ARMS' || item.ammunition <= 0) continue;
    const crew = weapons[item.weapon].crewRequired;
    const count = Math.min(item.quantity, Math.floor(free / crew));
    if (count <= 0) continue;
    usable.push({ weapon: item.weapon, count });
    free -= count * crew;
  }
  for (const item of equipment) {
    if (item.weapon !== 'SMALL_ARMS' || item.ammunition <= 0) continue;
    const count = Math.min(item.quantity, free);
    if (count > 0) usable.push({ weapon: item.weapon, count });
  }
  return usable;
}

export type AirWeapon = Readonly<{ weapon: WeaponType; count: number; definition: WeaponDefinition }>;

export function airWeapons(equipment: readonly Equipment[], personnel: number, weapons: WeaponTable): readonly AirWeapon[] {
  return usableWeapons(equipment, personnel, weapons)
    .filter(({ weapon }) => weapons[weapon].targetDomains.includes('AIR'))
    .map(({ weapon, count }) => ({ weapon, count, definition: weapons[weapon] }));
}

/** Chance per engagement: falls with altitude and with three-dimensional distance (§8.3). */
export function airHitChance(
  { definition, count }: AirWeapon,
  slantMeters: number,
  altitudeMeters: number,
): number {
  if (altitudeMeters > definition.maxAltitudeMeters || slantMeters > definition.rangeMeters) return 0;
  const altitude = 1 - altitudeMeters / definition.maxAltitudeMeters;
  const range = 1 - slantMeters / definition.rangeMeters;
  return Math.min(1, count * definition.airHitChance * altitude * range);
}

export function isAntiAir(weapon: WeaponType): boolean {
  return weapon === 'AAA' || weapon === 'MANPADS';
}

/**
 * Ground distance inside which the chance of being hit stays above `riskPerMinute`,
 * allowing for how often the weapon fires. Zero if it never gets that dangerous.
 */
export function threatRadiusMeters(
  definition: WeaponDefinition,
  altitudeMeters: number,
  riskPerMinute: number,
): number {
  if (altitudeMeters > definition.maxAltitudeMeters) return 0;
  const shotsPerMinute = 60 / definition.airCycleSeconds;
  const peak = definition.airHitChance * (1 - altitudeMeters / definition.maxAltitudeMeters) * shotsPerMinute;
  const slant = definition.rangeMeters * (1 - riskPerMinute / peak);
  return slant <= altitudeMeters ? 0 : Math.sqrt(slant * slant - altitudeMeters * altitudeMeters);
}

/** Crew-served weapons that can fire on ground targets now. */
export function supportWeaponCount(
  equipment: readonly Equipment[],
  personnel: number,
  weapons: WeaponTable,
): number {
  return usableWeapons(equipment, personnel, weapons)
    .filter(({ weapon }) => weapon !== 'SMALL_ARMS' && weapons[weapon].targetDomains.includes('GROUND'))
    .reduce((sum, { count }) => sum + count, 0);
}
