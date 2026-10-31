import type { WeaponType } from './equipment';
import type { Vec2 } from './geometry';
import type { ContactId } from './ground';

export type PositionEstimate = Readonly<{
  center: Vec2;
  sigmaMeters: number;
  headingRad: number | null;
  speedMps: number | null;
  observedAt: number;
}>;

export type StrengthEstimate =
  | Readonly<{ kind: 'unknown' }>
  | Readonly<{ kind: 'range'; min: number; max: number }>;

export type Identification = 'unidentified' | 'friendly' | 'hostile';
export type Provenance = Readonly<{ sourceId: string; observedAt: number }>;
export type ContactActivity = 'moving' | 'engaging' | 'stationary' | 'unknown';
export type Confidence = 'low' | 'medium' | 'high';

export type ContactEstimate = Readonly<{
  contactId: ContactId;
  provenance: Provenance;
  identification: Identification;
  position: PositionEstimate;
  strength: StrengthEstimate;
  kind: 'infantry' | 'vehicle' | 'unknown';
  activity: ContactActivity;
  confidence: Confidence;
  observedWeapons: readonly WeaponType[];
}>;

const STRENGTH_CATEGORIES: readonly (readonly [min: number, max: number])[] = [
  [1, 5],
  [6, 14],
  [15, 50],
  [51, 150],
  [151, 500],
];

/** Coarse category for an inferred headcount: fireteam up to larger than a company. */
export function strengthCategory(inferred: number): StrengthEstimate {
  for (const [min, max] of STRENGTH_CATEGORIES) {
    if (inferred <= max) return { kind: 'range', min, max };
  }
  return { kind: 'range', min: 501, max: 1000 };
}

const UNKNOWN_STRENGTH_ASSUMPTION = 15;

export function strengthMidpoint(strength: StrengthEstimate): number {
  return strength.kind === 'range' ? (strength.min + strength.max) / 2 : UNKNOWN_STRENGTH_ASSUMPTION;
}
