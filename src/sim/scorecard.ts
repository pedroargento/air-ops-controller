import type { SourceScore } from '../domain/public/debrief';
import { hypot } from '../domain/public/det-math';
import type { WorldTruth } from '../domain/truth/world';
import type { PlayerKnowledge } from '../knowledge/player-knowledge';

/*
 * After the run, how good each source's reports really were: the Admiralty code's
 * reliability, learned from the truth. It is read only for the debrief.
 */

const RELIABILITY_STEPS: readonly (readonly [meters: number, letter: string])[] = [
  [60, 'A'],
  [120, 'B'],
  [250, 'C'],
];

/** A for sources whose reports were close and never mistook a side, down to E for any mistake. */
export function reliabilityLetter(meanErrorMeters: number, misidentified: number): string {
  if (misidentified > 0) return 'E';
  return RELIABILITY_STEPS.find(([meters]) => meanErrorMeters <= meters)?.[1] ?? 'D';
}

export function sourceScorecard(truth: WorldTruth, player: PlayerKnowledge): readonly SourceScore[] {
  const scores = new Map<string, { reports: number; error: number; measured: number; misidentified: number; claimed: number }>();
  for (const key of Object.keys(player.contacts).sort()) {
    const entry = player.contacts[key];
    if (entry === undefined) continue;
    const { contact } = entry;
    const source = contact.provenance.sourceId;
    const score = scores.get(source) ?? { reports: 0, error: 0, measured: 0, misidentified: 0, claimed: 0 };
    score.reports += 1;
    const tracks = truth.tracks[source] ?? {};
    const unitId = Object.keys(tracks).find((id) => tracks[id]?.contactId === contact.contactId);
    const track = unitId === undefined ? undefined : tracks[unitId];
    const unit = truth.units.find((candidate) => candidate.id === unitId);
    if (track !== undefined && track.lastSeenTick === contact.position.observedAt) {
      // The estimate's own error, from where the unit really was when it was seen.
      score.error += hypot(contact.position.center.x - track.lastSeenPosition.x, contact.position.center.y - track.lastSeenPosition.y);
      score.measured += 1;
    }
    if (unit !== undefined && contact.identification === 'hostile' && unit.side === 'friendly') score.misidentified += 1;
    scores.set(source, score);
  }
  // What each source believes it inflicted, once per enemy squad: its reports overlap, its belief doesn't.
  for (const [source, score] of scores) {
    score.claimed = Object.values(truth.tracks[source] ?? {}).reduce((sum, track) => sum + (track.claimed ?? 0), 0);
  }
  return [...scores.entries()].map(([sourceId, score]) => {
    const meanErrorMeters = score.measured === 0 ? 0 : Math.round(score.error / score.measured);
    return {
      sourceId,
      reports: score.reports,
      meanErrorMeters,
      misidentified: score.misidentified,
      claimed: score.claimed,
      reliability: reliabilityLetter(meanErrorMeters, score.misidentified),
    };
  });
}
