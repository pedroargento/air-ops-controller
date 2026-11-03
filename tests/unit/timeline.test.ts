import { describe, expect, it } from 'vitest';
import type { RadioMessage } from '../../src/domain/public/radio';
import type { PlayerView } from '../../src/knowledge/player-view';
import { neighbourEvent, Snapshots, timelineEvents } from '../../src/ui/timeline';

const message = (kind: RadioMessage['kind'], receivedAt: number): RadioMessage =>
  ({ id: `M-${receivedAt}`, senderId: 'F-A', observedAt: receivedAt, sentAt: receivedAt, receivedAt, kind, ownPosition: { center: { x: 0, y: 0 }, sigmaMeters: 10, headingRad: null, speedMps: null, observedAt: 0 }, position: { center: { x: 0, y: 0 }, sigmaMeters: 10, headingRad: null, speedMps: null, observedAt: 0 }, contact: null }) as unknown as RadioMessage;

describe('timeline', () => {
  it('marks what mattered on the radio and leaves routine traffic out', () => {
    const events = timelineEvents([message('POSITION_REPORT', 10), message('TIC', 20)], 50);
    expect(events.map((event) => [event.kind, event.tick, event.level])).toEqual([['TIC', 20, 'urgent']]);
  });

  it('keeps a snapshot every thirty seconds and shows the newest one at or before a moment', () => {
    const snapshots = new Snapshots();
    const view = (tick: number) => ({ tick }) as PlayerView;
    for (let tick = 0; tick <= 100; tick += 5) snapshots.record(view(tick));
    expect(snapshots.latestTick).toBe(90);
    expect(snapshots.at(75)?.tick).toBe(60);
    expect(snapshots.at(0)?.tick).toBe(0);
  });

  it('steps to the event before or after a moment', () => {
    const events = timelineEvents([message('TIC', 20), message('TIC', 80), message('TIC', 140)], 50);
    expect(neighbourEvent(events, 80, 1)?.tick).toBe(140);
    expect(neighbourEvent(events, 80, -1)?.tick).toBe(20);
    expect(neighbourEvent(events, 140, 1)).toBeNull();
  });
});
