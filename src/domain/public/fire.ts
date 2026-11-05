import type { ContactEstimate } from './estimates';
import type { Vec2 } from './geometry';

/*
 * Fire on the ground as the units in it understand it (§7.3). A unit knows when it is being
 * shot at, may know where from, and knows what it is shooting at. None of this is truth: an
 * unseen shooter is only a bearing, and a seen one is the unit's own contact, errors included.
 */

export type FireIntensity = 'light' | 'heavy';

/**
 * Where a unit believes fire on it comes from. A shooter it can see is one of its contacts. An
 * unseen one is only a direction, from where the unit is to the shooter, with its spread.
 */
export type IncomingFire = Readonly<{
  contact: ContactEstimate | null;
  bearingRad: number;
  spreadRad: number;
  /** Where the squad that felt the fire was, which the direction is measured from. */
  origin: Vec2;
  observedAt: number;
}>;

/** A unit's own fight, kept in its picture and sent with its reports. */
export type FireKnowledge = {
  /** When this spell of being fired on began, or null when not under fire. */
  since: number | null;
  /** When it was last fired on. */
  lastAt: number | null;
  /** When the fire on it was last heavy: men falling, or pinned down. */
  heavyAt: number | null;
  /** Where the fire comes from, by contact or by direction. */
  from: Record<string, IncomingFire>;
  /** Contacts it is firing at, and when it last did. */
  engaging: Record<string, number>;
};

/** What a report says about the sender's fight. */
export type FireStatus = Readonly<{
  underFire: boolean;
  intensity: FireIntensity;
  since: number | null;
  from: readonly IncomingFire[];
  engaging: readonly ContactEstimate[];
}>;

export function emptyFire(): FireKnowledge {
  return { since: null, lastAt: null, heavyAt: null, from: {}, engaging: {} };
}
