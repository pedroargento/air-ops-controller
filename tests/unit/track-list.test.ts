import { describe, expect, it } from 'vitest';
import type { ContactMarker } from '../../src/knowledge/player-view';
import { sortedTracks, threatScore } from '../../src/ui/track-list';

const marker = (key: string, overrides: Partial<ContactMarker['contact']> = {}, extra: Partial<ContactMarker> = {}): ContactMarker =>
  ({
    key,
    contact: { identification: 'hostile', confidence: 'medium', strength: { kind: 'range', min: 6, max: 14 }, observedWeapons: [], ...overrides },
    ageSeconds: 60,
    engaging: false,
    status: 'active',
    estimatedLosses: 0,
    members: [],
    stale: false,
    trackNumber: 4001,
    ambiguous: false,
    ...extra,
  }) as unknown as ContactMarker;

describe('track list', () => {
  it('puts air defense first, then units fighting, then the rest, and destroyed ones last', () => {
    const tracks = sortedTracks(
      [
        marker('plain'),
        marker('gone', {}, { status: 'destroyed' }),
        marker('fighting', {}, { engaging: true }),
        marker('manpads', { observedWeapons: ['MANPADS'] }),
        marker('ours', { identification: 'friendly' }),
      ],
      'threat',
    );
    expect(tracks.map((t) => t.key)).toEqual(['manpads', 'fighting', 'plain', 'gone']);
  });

  it('ranks a suspect below a confirmed hostile', () => {
    expect(threatScore(marker('a', { confidence: 'low' }))).toBeLessThan(threatScore(marker('b')));
  });

  it('sorts by newest sighting, or by least damaged', () => {
    const fresh = marker('fresh', {}, { ageSeconds: 5 });
    const old = marker('old', {}, { ageSeconds: 500 });
    expect(sortedTracks([old, fresh], 'age').map((t) => t.key)).toEqual(['fresh', 'old']);
    const hurt = marker('hurt', {}, { estimatedLosses: 8 });
    expect(sortedTracks([hurt, fresh], 'condition').map((t) => t.key)).toEqual(['fresh', 'hurt']);
  });
});
