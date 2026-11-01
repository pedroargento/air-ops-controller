import { POI_KINDS } from '../domain/public/poi';
import type { DrillKind } from '../domain/public/ground';
import type { AircraftTelemetryEntry } from '../domain/public/air';
import type { GroundFireEffect } from '../knowledge/player-view';
import { isAntiAir, type WeaponType } from '../domain/public/equipment';
import type { ContactEstimate, StrengthEstimate } from '../domain/public/estimates';
import { distance, type Vec2 } from '../domain/public/geometry';
import { AIR_OPS, CECON, reportLevel, type RadioMessage, type ReportLevel, type StrikeAssessment } from '../domain/public/radio';
import type { ContactMarker, ContactStatus } from '../knowledge/player-view';

export type Names = Readonly<Record<string, string>>;

export function displayName(id: string, names: Names): string {
  if (id === AIR_OPS) return 'Air Control';
  if (id === CECON) return 'CECON';
  return names[id] ?? id;
}

export function clock(tick: number): string {
  const minutes = Math.floor(tick / 60);
  const seconds = tick % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Grid reference by terrain cell, as column-row. */
export function gridRef(point: Vec2, cellSize: number): string {
  const part = (value: number): string => String(Math.max(0, Math.floor(value / cellSize))).padStart(3, '0');
  return `${part(point.x)}-${part(point.y)}`;
}

/** Grid reference under the cursor, or null off the map, where a clamped grid would mislead. */
export function cursorGrid(point: Vec2, worldSize: number, cellSize: number): string | null {
  const onMap = point.x >= 0 && point.y >= 0 && point.x < worldSize && point.y < worldSize;
  return onMap ? `Grid ${gridRef(point, cellSize)}` : null;
}

/** Longest round length (1, 2 or 5 times a power of ten) that fits in `maxPixels`. */
export function scaleBarMeters(pixelsPerMeter: number, maxPixels: number): number {
  const limit = maxPixels / pixelsPerMeter;
  let power = 1;
  while (power * 10 <= limit) power *= 10;
  if (power * 5 <= limit) return power * 5;
  return power * 2 <= limit ? power * 2 : power;
}

export function distanceText(meters: number): string {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
}

const WEAPON_NAMES: Readonly<Record<WeaponType, string>> = {
  SMALL_ARMS: 'small arms',
  MACHINE_GUN: 'machine guns',
  AAA: 'AAA',
  MANPADS: 'MANPADS',
};

export function weaponsText(weapons: readonly WeaponType[]): string {
  return weapons.length === 0 ? 'Weapons not observed' : `Weapons seen: ${weapons.map((w) => WEAPON_NAMES[w]).join(', ')}`;
}

export function groundFireText(fire: GroundFireEffect, cellSize: number): string {
  return [
    `Ground fire${fire.hit ? ', aircraft hit' : ''}`,
    `Reported by ${fire.aircraftId}, ${Math.round(fire.ageSeconds / 60)} min ago`,
    fire.weapon === null ? 'Weapon not seen' : `Weapon: ${WEAPON_NAMES[fire.weapon]}`,
    `Estimated source, grid ${gridRef(fire.position, cellSize)}`,
  ].join('\n');
}

const ALTITUDE_STEP_METERS = 100;

// The interesting detail is low down, so the scale opens up there.
export function altitudeFraction(meters: number, maxMeters: number): number {
  return Math.sqrt(Math.max(0, meters) / maxMeters);
}

export function snappedAltitude(fraction: number, maxMeters: number): number {
  const clamped = Math.max(0, Math.min(1, fraction));
  return Math.round((clamped * clamped * maxMeters) / ALTITUDE_STEP_METERS) * ALTITUDE_STEP_METERS;
}

/** RECON-1 becomes R1, so columns stay narrow however many aircraft are up. */
export function shortAircraftName(id: string): string {
  return `${id.charAt(0)}${id.replace(/\D/g, '')}`;
}

export function aircraftMission(aircraft: AircraftTelemetryEntry): string {
  return aircraft.casPhase ?? (aircraft.order === null ? 'no mission' : aircraft.order.kind);
}

export function aircraftSummary(aircraft: AircraftTelemetryEntry): string {
  const status = aircraft.damaged ? `DAMAGED ${aircraft.status}` : aircraft.status;
  return (
    `${aircraft.aircraftId} (${aircraft.model}): ${status}, ${aircraftMission(aircraft)}, ${Math.round(aircraft.altitudeMeters)} m, ` +
    `fuel ${Math.round(aircraft.fuelFraction * 100)}%, ordnance ${aircraft.ammunition}`
  );
}

export function ceilingLabel(weapon: WeaponType): string {
  return weaponTag([weapon]) ?? 'SA';
}

const WEAPON_TAGS: Readonly<Record<WeaponType, string | null>> = {
  SMALL_ARMS: null,
  MACHINE_GUN: 'MG',
  AAA: 'AAA',
  MANPADS: 'MP',
};

/** Map tag for the weapons seen, most dangerous to aircraft first. Nearly everyone has small arms. */
export function weaponTag(weapons: readonly WeaponType[]): string | null {
  const tags = [...weapons]
    .sort((a, b) => Number(isAntiAir(b)) - Number(isAntiAir(a)))
    .flatMap((weapon) => WEAPON_TAGS[weapon] ?? []);
  return tags.length === 0 ? null : tags.join(' ');
}

export function strengthText(strength: StrengthEstimate): string {
  if (strength.kind === 'unknown') return 'unknown strength';
  if (strength.max <= 5) return 'fireteam-sized';
  if (strength.max <= 14) return 'squad-sized';
  if (strength.max <= 50) return 'platoon-sized';
  if (strength.max <= 150) return 'company-sized';
  return 'larger than company';
}

const COMPASS = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'] as const;

/** World y grows southward, so heading 0 is east and a quarter turn is south. */
export function compassDirection(headingRad: number): string {
  const octant = Math.round(headingRad / (Math.PI / 4));
  return COMPASS[((octant % 8) + 8) % 8] ?? 'east';
}

function contactSummary(contact: ContactEstimate): string {
  const identity = contact.identification === 'hostile' ? 'hostile' : contact.identification === 'unidentified' ? 'unidentified' : 'friendly';
  const kind = contact.kind === 'unknown' ? 'contact' : contact.kind;
  const heading = contact.position.headingRad === null ? '' : `, moving ${compassDirection(contact.position.headingRad)}`;
  return `${strengthText(contact.strength)} ${identity} ${kind}${heading}`;
}

function strikeOutcome(effect: 'effect-observed' | 'no-effect-observed', assessment: StrikeAssessment | null): string {
  if (effect === 'no-effect-observed') return 'no effect observed';
  if (assessment === null) return 'effect observed';
  if (assessment.destroyed) return `target destroyed, about ${assessment.estimatedCasualties} casualties`;
  return `effect observed, about ${assessment.estimatedCasualties} casualties`;
}

/** Diamond half-width by reported strength, so mass shows at a glance. */
export function markerSize(strength: StrengthEstimate): number {
  if (strength.kind === 'unknown') return 7;
  if (strength.max <= 5) return 5;
  if (strength.max <= 14) return 7;
  return strength.max <= 50 ? 9 : 12;
}

const STATUS_TEXT: Readonly<Record<ContactStatus, string | null>> = {
  active: null,
  hit: 'Hit by air strike',
  destroyed: 'Reported destroyed',
  'not-found': 'Not found at this position',
};

export function statusText(status: ContactStatus, estimatedLosses: number): string | null {
  const text = STATUS_TEXT[status];
  if (text === null) return null;
  return estimatedLosses > 0 ? `${text}, about ${estimatedLosses} casualties` : text;
}

export function rangeText({ low, high }: Readonly<{ low: number; high: number }>): string {
  return low === high ? String(low) : `${low}–${high}`;
}

/** Enemy per defender, as a range. Null with nobody reported at the objective. */
export function forceRatioText(enemy: Readonly<{ low: number; high: number }>, defenders: number): string | null {
  if (defenders <= 0) return null;
  const round = (value: number): number => (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10);
  return `${rangeText({ low: round(enemy.low / defenders), high: round(enemy.high / defenders) })} : 1`;
}

const DRILL_TEXT: Readonly<Record<DrillKind, string>> = {
  nearAmbush: 'ambushed, assaulting through',
  farAmbush: 'under fire, returning fire and flanking',
  attack: 'attacking a known position',
  bypass: 'bypassing a known position',
  hastyAmbush: 'setting a hasty ambush',
  waitForAir: 'holding short of a known position for air',
};

export type ContactMemory = Readonly<{ center: Vec2; at: number; strengthMax: number }>;

export type TriageParameters = Readonly<{ repeatContactSeconds: number; repeatContactMeters: number }>;

const strengthMax = (contact: ContactEstimate): number => (contact.strength.kind === 'unknown' ? 0 : contact.strength.max);

/**
 * Which messages the main radio view shows. A contact report is news the first time, or
 * if it says the enemy is stronger; otherwise it repeats what the player has already heard.
 */
export function triage(
  message: RadioMessage,
  heard: readonly ContactMemory[],
  parameters: TriageParameters,
): Readonly<{ level: ReportLevel; heard: readonly ContactMemory[] }> {
  if (message.kind !== 'CONTACT_REPORT') return { level: reportLevel(message), heard };
  const at = message.receivedAt;
  const { center } = message.contact.position;
  const strength = strengthMax(message.contact);
  const kept = heard.filter((entry) => at - entry.at <= parameters.repeatContactSeconds);
  const repeat = kept.some(
    (entry) => distance(entry.center, center) <= parameters.repeatContactMeters && strength <= entry.strengthMax,
  );
  return { level: repeat ? 'routine' : 'main', heard: [...kept, { center, at, strengthMax: strength }] };
}

export type RadioLine = Readonly<{ text: string; coordinates: readonly Vec2[] }>;

/** Natural-language template for a message, plus the reported points it mentions. */
export function radioLine(message: RadioMessage, cellSize: number): RadioLine {
  const grid = (point: Vec2): string => `grid ${gridRef(point, cellSize)}`;
  switch (message.kind) {
    case 'TIC': {
      const contact = message.contact;
      const coordinates = contact === null ? [message.ownPosition.center] : [message.ownPosition.center, contact.position.center];
      const enemy = contact === null ? 'enemy position unknown' : `${contactSummary(contact)} near ${grid(contact.position.center)}`;
      return { text: `Troops in contact at ${grid(message.ownPosition.center)}. ${enemy}.`, coordinates };
    }
    case 'CONTACT_REPORT':
      return {
        text: `Contact: ${contactSummary(message.contact)} near ${grid(message.contact.position.center)}. ${message.contact.confidence} confidence.`,
        coordinates: [message.contact.position.center],
      };
    case 'POSITION_REPORT':
      return { text: `Position ${grid(message.position.center)}.`, coordinates: [message.position.center] };
    case 'SITREP':
      return {
        text: `SITREP from ${grid(message.ownPosition.center)}: ${message.personnel} effectives, ammunition ${Math.round(message.ammunitionFraction * 100)}%, ${message.status}.`,
        coordinates: [message.ownPosition.center],
      };
    case 'DRILL':
      return { text: `At ${grid(message.ownPosition.center)}: ${DRILL_TEXT[message.drill]}.`, coordinates: [message.ownPosition.center] };
    case 'POI_REPORT': {
      const { label } = POI_KINDS[message.poi.kind];
      const text = message.cancelled ? `Cancel ${label.toLowerCase()} at` : `${label} at`;
      return { text: `${text} ${grid(message.poi.center)}.`, coordinates: [message.poi.center] };
    }
    case 'SUPPORT_REQUEST':
      return { text: `Requesting air support at ${grid(message.ownPosition.center)}.`, coordinates: [message.ownPosition.center] };
    case 'COMMAND_UPDATE':
      return { text: message.text, coordinates: [] };
    case 'ACKNOWLEDGEMENT':
      return { text: message.supportCancelled ? 'Air support cancelled.' : 'Request acknowledged.', coordinates: [] };
    case 'INTEL_REPORT':
      return {
        text: `Intel relayed: ${contactSummary(message.contact)} near ${grid(message.contact.position.center)}.`,
        coordinates: [message.contact.position.center],
      };
    case 'GROUND_FIRE':
      return {
        text: `${message.damaged ? 'Hit by ground fire, returning to base' : message.hit ? 'Hit by ground fire, still flying' : 'Taking ground fire'}${message.weapon === null ? '' : ` (${WEAPON_NAMES[message.weapon]})`}, source near ${grid(message.source.center)}.`,
        coordinates: [message.source.center],
      };
    case 'STRIKE_RESULT':
      return {
        text: `Strike near ${grid(message.contact.position.center)}: ${strikeOutcome(message.effect, message.assessment)}.`,
        coordinates: [message.contact.position.center],
      };
  }
}

function ageText(seconds: number): string {
  if (seconds < 60) return 'under a minute ago';
  const minutes = Math.floor(seconds / 60);
  return minutes === 1 ? 'one minute ago' : `${minutes} minutes ago`;
}

/** The exact words the player will send when forwarding a contact. */
export function forwardPreview(marker: ContactMarker, recipients: readonly string[], names: Names, cellSize: number): string {
  const { contact } = marker;
  const addressees = recipients.map((id) => displayName(id, names)).join(', ');
  const source = displayName(contact.provenance.sourceId, names);
  const center = contact.position.center;
  return (
    `${addressees || '(no recipient)'}, Air Control. ${source} reports ${contactSummary(contact)} near grid ` +
    `${gridRef(center, cellSize)}. ${contact.confidence} confidence, observed ${ageText(marker.ageSeconds)}.`
  );
}
