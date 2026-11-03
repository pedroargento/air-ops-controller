import type { Vec2 } from '../domain/public/geometry';
import { reportLevel, type RadioMessage, type ReportLevel } from '../domain/public/radio';
import type { PlayerView } from '../knowledge/player-view';
import { radioLine } from './format';

/*
 * The timeline: the battle as the controller knew it, moment by moment. Snapshots of the
 * player's own view are kept as the run goes, so going back shows what was on the map then,
 * not what is known now. Truth is added only after the run, by the caller.
 */

export const SNAPSHOT_SECONDS = 30;

export type TimelineEvent = Readonly<{ tick: number; senderId: string; kind: RadioMessage['kind']; level: ReportLevel; text: string; point: Vec2 | null }>;

/** The moments worth marking on the timeline: everything above routine on the radio. */
export function timelineEvents(log: readonly RadioMessage[], cellSize: number): readonly TimelineEvent[] {
  return log.flatMap((message): TimelineEvent[] => {
    const level = reportLevel(message);
    if (level === 'routine') return [];
    const line = radioLine(message, cellSize);
    return [{ tick: message.receivedAt, senderId: message.senderId, kind: message.kind, level, text: line.text, point: line.coordinates.at(-1) ?? null }];
  });
}

export class Snapshots {
  private readonly kept: { tick: number; view: PlayerView }[] = [];

  /** Keeps a view every SNAPSHOT_SECONDS of game time, and the very first one. */
  record(view: PlayerView): void {
    const last = this.kept.at(-1);
    if (last !== undefined && view.tick - last.tick < SNAPSHOT_SECONDS) return;
    this.kept.push({ tick: view.tick, view });
  }

  get latestTick(): number {
    return this.kept.at(-1)?.tick ?? 0;
  }

  /** The newest snapshot at or before the moment asked for. */
  at(tick: number): PlayerView | null {
    let found: PlayerView | null = null;
    for (const entry of this.kept) {
      if (entry.tick > tick) break;
      found = entry.view;
    }
    return found ?? this.kept[0]?.view ?? null;
  }
}

/** The event before or after a moment, for stepping through the timeline. */
export function neighbourEvent(events: readonly TimelineEvent[], tick: number, direction: 1 | -1): TimelineEvent | null {
  const ordered = direction === 1 ? events.filter((event) => event.tick > tick) : events.filter((event) => event.tick < tick).reverse();
  return ordered[0] ?? null;
}
