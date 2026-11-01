import { isAntiAir } from '../domain/public/equipment';
import { distance, type Vec2 } from '../domain/public/geometry';
import type { ContactEstimate } from '../domain/public/estimates';
import { couldBeSameReport, type ContactMarker, type PlayerView } from '../knowledge/player-view';

export type Range = Readonly<{ low: number; high: number }>;

// Rough sizes for what can't be counted: a report with no strength, and how far
// casualty estimates are trusted, because crews overclaim and underclaim alike.
const UNKNOWN_STRENGTH = { min: 5, max: 50 };
const LOSS_ERROR = 0.3;

const midpoint = ({ low, high }: Range): number => (low + high) / 2;


export type SectorSummary = Readonly<{
  name: string;
  strength: Range;
  reports: number;
  activity: string;
  ageSeconds: number;
  stale: boolean;
}>;

export type FriendlySummary = Readonly<{
  unitId: string;
  personnel: number;
  fromReport: boolean;
  ammunitionPercent: number | null;
  ageSeconds: number;
  silent: boolean;
  atObjective: boolean;
}>;

export type BattleSummary = Readonly<{
  known: Range;
  groups: number;
  unconfirmed: number;
  hqEstimate: number;
  losses: Range;
  confirmedDestroyed: number;
  unlocated: Range;
  sectors: readonly SectorSummary[];
  airThreats: readonly Readonly<{ sector: string; weapons: string }>[];
  friendlies: readonly FriendlySummary[];
  defenders: number;
  threatened: Range;
  strikes: number;
  aircraftHits: number;
  damagedNow: number;
  archived: number;
}>;

export type SummaryConfig = Readonly<{
  objective: Vec2;
  objectiveRadiusMeters: number;
  areaLabel: string;
  hqEnemyEstimate: number;
  ratioRadiusMeters: number;
  staleSeconds: number;
  friendlyStrength: Readonly<Record<string, number>>;
  plausibleSpeedMps: number;
}>;

function strengthOf(contact: ContactEstimate): Range {
  if (contact.strength.kind === 'unknown') return { low: UNKNOWN_STRENGTH.min, high: UNKNOWN_STRENGTH.max };
  return { low: contact.strength.min, high: contact.strength.max };
}

/** World y grows southward, so north is negative y. */
export function sectorOf(point: Vec2, objective: Vec2): string {
  const dx = point.x - objective.x;
  const dy = point.y - objective.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'East' : 'West';
  return dy > 0 ? 'South' : 'North';
}

/**
 * The high end counts every report as its own unit, at its likeliest size; the low end
 * counts reports that could be one unit once, at their smallest. Good recon therefore shows up as a narrower range, not a new number.
 */
export function strengthRange(markers: readonly ContactMarker[], plausibleSpeedMps: number): Range & { clusters: number } {
  const clusters: ContactMarker[][] = [];
  for (const marker of markers) {
    const cluster = clusters.find((group) =>
      group.some((other) => couldBeSameReport(other, marker, plausibleSpeedMps)),
    );
    if (cluster === undefined) clusters.push([marker]);
    else cluster.push(marker);
  }
  // Midpoints, not top ends: strength bands are wide, and adding their tops gives absurd totals.
  const high = Math.round(markers.reduce((sum, marker) => sum + midpoint(strengthOf(marker.contact)), 0));
  const low = clusters.reduce(
    (sum, cluster) => sum + Math.max(...cluster.map((marker) => strengthOf(marker.contact).low)),
    0,
  );
  return { low, high, clusters: clusters.length };
}

const activityRank: Readonly<Record<string, number>> = { engaging: 3, moving: 2, stationary: 1, unknown: 0 };

function sectorSummary(name: string, markers: readonly ContactMarker[], config: SummaryConfig): SectorSummary {
  const { low, high } = strengthRange(markers, config.plausibleSpeedMps);
  const ageSeconds = Math.min(...markers.map((marker) => marker.ageSeconds));
  const activity = [...markers]
    .map((marker) => marker.contact.activity)
    .sort((a, b) => (activityRank[b] ?? 0) - (activityRank[a] ?? 0))[0];
  return {
    name,
    strength: { low, high },
    reports: markers.length,
    activity: activity ?? 'unknown',
    ageSeconds,
    stale: ageSeconds >= config.staleSeconds,
  };
}

function friendlySummaries(view: PlayerView, config: SummaryConfig): readonly FriendlySummary[] {
  return view.friendlies.map((marker) => {
    const report = marker.statusReport;
    return {
      unitId: marker.unitId,
      personnel: report?.personnel ?? config.friendlyStrength[marker.unitId] ?? 0,
      fromReport: report !== null,
      ammunitionPercent: report === null ? null : Math.round(report.ammunitionFraction * 100),
      ageSeconds: marker.ageSeconds,
      silent: marker.silent,
      atObjective: distance(marker.position.center, config.objective) <= config.objectiveRadiusMeters,
    };
  });
}

/** One line per weapon and sector: several reports of one team shouldn't read as several teams. */
function airThreats(hostile: readonly ContactMarker[], config: SummaryConfig): BattleSummary['airThreats'] {
  const seen = new Map<string, Readonly<{ sector: string; weapons: string }>>();
  for (const marker of hostile) {
    const sector = sectorOf(marker.contact.position.center, config.objective);
    for (const weapon of marker.contact.observedWeapons.filter(isAntiAir)) {
      seen.set(`${weapon}/${sector}`, { sector, weapons: weapon });
    }
  }
  return [...seen.values()];
}

/** Everything here comes from the PlayerView: what was reported, never what is true. */
export function summarizeBattle(view: PlayerView, config: SummaryConfig): BattleSummary {
  const hostile = view.contacts.filter(
    (marker) =>
      marker.contact.identification === 'hostile' && marker.status !== 'destroyed' && marker.status !== 'not-found',
  );
  const { low, high, clusters } = strengthRange(hostile, config.plausibleSpeedMps);
  const losses = {
    low: Math.round(view.estimatedLosses * (1 - LOSS_ERROR)),
    high: Math.round(view.estimatedLosses * (1 + LOSS_ERROR)),
  };
  const near = hostile.filter(
    (marker) => distance(marker.contact.position.center, config.objective) <= config.ratioRadiusMeters,
  );
  const threatened = strengthRange(near, config.plausibleSpeedMps);
  const friendlies = friendlySummaries(view, config);
  const sectors = ['North', 'East', 'South', 'West'].flatMap((name) => {
    const markers = hostile.filter((marker) => sectorOf(marker.contact.position.center, config.objective) === name);
    return markers.length === 0 ? [] : [sectorSummary(name, markers, config)];
  });
  return {
    known: { low, high },
    groups: clusters,
    unconfirmed: hostile.length - clusters,
    hqEstimate: config.hqEnemyEstimate,
    losses,
    confirmedDestroyed: view.confirmedDestroyed,
    unlocated: {
      low: Math.max(0, config.hqEnemyEstimate - high - losses.high),
      high: Math.max(0, config.hqEnemyEstimate - low - losses.low),
    },
    sectors,
    airThreats: airThreats(hostile, config),
    friendlies,
    defenders: friendlies
      .filter((unit) => unit.atObjective && !unit.silent)
      .reduce((sum, unit) => sum + unit.personnel, 0),
    threatened: { low: threatened.low, high: threatened.high },
    strikes: view.log.filter((message) => message.kind === 'STRIKE_RESULT').length,
    aircraftHits: view.log.filter((message) => message.kind === 'GROUND_FIRE' && message.damaged).length,
    damagedNow: view.aircraft.filter((aircraft) => aircraft.damaged).length,
    archived: view.archivedContacts,
  };
}
