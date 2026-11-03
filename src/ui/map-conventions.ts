import type { CasPhase } from '../domain/public/air';
import { strengthMidpoint, type ContactEstimate, type StrengthEstimate } from '../domain/public/estimates';
import type { Vec2 } from '../domain/public/geometry';
import type { TerrainGrid } from '../domain/public/terrain';
import type { ContactMarker } from '../knowledge/player-view';

/*
 * Map conventions borrowed from NATO practice: unit size marks and the operational-condition
 * bar from APP-6, report ratings from the Admiralty code, maximum elevation figures and spot
 * heights from charts, and brevity words from the radio. Pure decisions here; drawing is in
 * the map view.
 */

/** APP-6 size marks, smallest first. */
export type Echelon = 'team' | 'squad' | 'section' | 'platoon' | 'company' | 'battalion';

export const ECHELON_MARKS: Readonly<Record<Echelon, string>> = {
  team: 'ø',
  squad: '•',
  section: '••',
  platoon: '•••',
  company: '|',
  battalion: '||',
};

/** The size a head count suggests. */
export function echelonOf(personnel: number): Echelon {
  if (personnel <= 5) return 'team';
  if (personnel <= 14) return 'squad';
  if (personnel <= 20) return 'section';
  if (personnel <= 50) return 'platoon';
  if (personnel <= 150) return 'company';
  return 'battalion';
}

/** The size an estimate suggests, by the largest it could be. Unknown strength has no mark. */
export function estimatedEchelon(strength: StrengthEstimate): Echelon | null {
  return strength.kind === 'unknown' ? null : echelonOf(strength.max);
}

/** APP-6 operational condition, shown as a bar under the symbol. */
export type Condition = 'capable' | 'damaged' | 'badlyDamaged';

export type ConditionEstimate = Readonly<{
  /** Share of the unit believed lost: claims against claims plus what's still thought to be there. */
  lostShare: number;
  condition: Condition;
  /** Claims add up to the whole unit, but nobody has seen it dead. */
  probablyDestroyed: boolean;
}>;

const DAMAGED_SHARE = 1 / 3;
const BADLY_DAMAGED_SHARE = 2 / 3;
const PROBABLY_DESTROYED_SHARE = 0.9;

function conditionFromShare(lostShare: number): ConditionEstimate {
  const condition: Condition = lostShare >= BADLY_DAMAGED_SHARE ? 'badlyDamaged' : lostShare >= DAMAGED_SHARE ? 'damaged' : 'capable';
  return { lostShare, condition, probablyDestroyed: lostShare >= PROBABLY_DESTROYED_SHARE };
}

/** A contact's condition from claimed losses. Null when nothing has been claimed: no bar at all. */
export function contactCondition(claimedLosses: number, strength: StrengthEstimate): ConditionEstimate | null {
  if (claimedLosses <= 0) return null;
  const remaining = strengthMidpoint(strength);
  return conditionFromShare(claimedLosses / (claimedLosses + remaining));
}

/** A friendly unit's condition from its own last report against its starting strength. */
export function friendlyCondition(reported: number, initial: number): ConditionEstimate | null {
  if (initial <= 0 || reported >= initial) return null;
  return conditionFromShare(Math.max(0, initial - reported) / initial);
}

export const CONDITION_COLORS: Readonly<Record<Condition, string>> = {
  capable: '#2e9e44',
  damaged: '#e0b020',
  badlyDamaged: '#d22c2c',
};

/**
 * Admiralty rating: how reliable the source is (A–F) and how credible the information
 * (1–6). An aircraft looking from overhead is usually reliable, a platoon reporting what it
 * glimpsed fairly so. A report confirmed by another source is the most credible.
 */
export function admiraltyRating(marker: Pick<ContactMarker, 'viaAircraft' | 'contact' | 'members'>): string {
  const reliability = marker.viaAircraft ? 'B' : 'C';
  const source = marker.contact.provenance.sourceId;
  const confirmed = marker.members.some((member) => member.contact.provenance.sourceId !== source);
  const credibility = confirmed ? 1 : CREDIBILITY[marker.contact.confidence];
  return `${reliability}${credibility}`;
}

const CREDIBILITY: Readonly<Record<ContactEstimate['confidence'], number>> = { high: 2, medium: 3, low: 4 };

/** What the crew would say on the radio about what it's doing. */
export const BREVITY: Readonly<Record<CasPhase, string>> = {
  searching: 'NO JOY',
  identifying: 'CONTACT',
  'target-acquired': 'TALLY',
  'attack-run': 'IN HOT',
  'breaking-off': 'DEFENDING',
  'holding-danger-close': 'HOLDING, FRIENDLIES',
  suppressing: 'SUPPRESSING',
  'weapons-hold': 'WEAPONS HOLD',
  'out-of-ordnance': 'WINCHESTER',
};

export type SpotHeight = Readonly<{ point: Vec2; meters: number }>;

/** Summits: the highest cell for some distance around that stands well above its surroundings. */
export function spotHeights(grid: TerrainGrid, radiusCells = 8, prominenceMeters = 40): readonly SpotHeight[] {
  const at = (column: number, row: number): number => grid.elevation[row * grid.width + column] ?? 0;
  const peaks: SpotHeight[] = [];
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const height = at(column, row);
      let highest = true;
      let lowest = height;
      for (let y = Math.max(0, row - radiusCells); y <= Math.min(grid.height - 1, row + radiusCells) && highest; y += 1) {
        for (let x = Math.max(0, column - radiusCells); x <= Math.min(grid.width - 1, column + radiusCells); x += 1) {
          const other = at(x, y);
          // Ties go to the first cell in reading order, so a flat top gets one label.
          if (other > height || (other === height && y * grid.width + x < row * grid.width + column)) {
            highest = false;
            break;
          }
          lowest = Math.min(lowest, other);
        }
      }
      if (highest && height - lowest >= prominenceMeters) {
        peaks.push({ point: { x: (column + 0.5) * grid.cellSize, y: (row + 0.5) * grid.cellSize }, meters: height });
      }
    }
  }
  return peaks;
}

export type ElevationFigure = Readonly<{ origin: Vec2; sizeMeters: number; meters: number }>;

const FIGURE_ROUNDING_METERS = 10;

/**
 * Maximum elevation figures, as on aviation charts: the highest ground in each grid square,
 * rounded up, so a pilot can see at a glance where an altitude doesn't clear the hills.
 */
export function maxElevationFigures(grid: TerrainGrid, blockMeters: number): readonly ElevationFigure[] {
  const cells = Math.max(1, Math.round(blockMeters / grid.cellSize));
  const figures: ElevationFigure[] = [];
  for (let top = 0; top < grid.height; top += cells) {
    for (let left = 0; left < grid.width; left += cells) {
      let highest = 0;
      for (let row = top; row < Math.min(grid.height, top + cells); row += 1) {
        for (let column = left; column < Math.min(grid.width, left + cells); column += 1) {
          highest = Math.max(highest, grid.elevation[row * grid.width + column] ?? 0);
        }
      }
      figures.push({
        origin: { x: left * grid.cellSize, y: top * grid.cellSize },
        sizeMeters: cells * grid.cellSize,
        meters: Math.ceil(highest / FIGURE_ROUNDING_METERS) * FIGURE_ROUNDING_METERS,
      });
    }
  }
  return figures;
}

/** A 20 m contour interval, with every fifth one an index contour that's drawn bolder and labeled. */
export const CONTOUR_INTERVAL_METERS = 20;
export const INDEX_CONTOUR_METERS = 100;
