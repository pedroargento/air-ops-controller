import type { Vec2 } from './geometry';

/** Kinds the player can report from the map. A new kind needs only an entry in `POI_KINDS`. */
export type PoiKind = 'killZone';

/** What a recipient does with a mark. */
export type PoiEffect = 'suspectedEnemy';

export type PoiDefinition = Readonly<{ label: string; radiusMeters: number; effect: PoiEffect }>;

export const POI_KINDS: Readonly<Record<PoiKind, PoiDefinition>> = {
  killZone: { label: 'Suspected kill zone', radiusMeters: 150, effect: 'suspectedEnemy' },
};

/** A place the player has marked and told units about. It is an opinion, not an observation. */
export type Poi = Readonly<{
  id: string;
  kind: PoiKind;
  center: Vec2;
  radiusMeters: number;
  placedAt: number;
  recipients: readonly string[];
}>;
