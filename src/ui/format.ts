import type { ContactEstimate, StrengthEstimate } from '../domain/public/estimates';
import type { Vec2 } from '../domain/public/geometry';
import { AIR_OPS, CECON, type RadioMessage } from '../domain/public/radio';
import type { ContactMarker } from '../knowledge/player-view';

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
    case 'STRIKE_RESULT':
      return {
        text: `Strike near ${grid(message.contact.position.center)}: ${message.effect === 'effect-observed' ? 'effect observed' : 'no effect observed'}.`,
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
