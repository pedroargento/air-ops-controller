import { describe, expect, it } from 'vitest';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import type { MessageId, RadioMessage } from '../../src/domain/public/radio';
import type { ContactMarker } from '../../src/knowledge/player-view';
import type { ContactId } from '../../src/domain/public/ground';
import { clock, clockSeconds, duration, setMissionStart, compassDirection, cursorGrid, distanceText, forwardPreview, gridRef, radioLine, triage, scaleBarMeters, strengthText } from '../../src/ui/format';

const names = { 'F-N': 'Viper 2-1' };
const contact: ContactEstimate = {
  contactId: 'C-14' as ContactId,
  provenance: { sourceId: 'RECON-1', observedAt: 100 },
  identification: 'hostile',
  position: { center: { x: 2120, y: 4060 }, sigmaMeters: 40, headingRad: (3 * Math.PI) / 4, speedMps: 1, observedAt: 100 },
  strength: { kind: 'range', min: 15, max: 50 },
  kind: 'infantry',
  activity: 'moving',
  confidence: 'medium',
  observedWeapons: [],
};
const meta = { id: 'M-1' as MessageId, senderId: 'F-N', observedAt: 100, sentAt: 110, receivedAt: 130 };

describe('formatting', () => {
  it('formats military time from the mission start, durations, and grid references', () => {
    setMissionStart('0545');
    expect(clock(0)).toBe('0545');
    expect(clock(125)).toBe('0547');
    expect(clockSeconds(125)).toBe('0547:05');
    expect(clock(19 * 3600)).toBe('0045');
    setMissionStart('0000');
    expect(duration(65)).toBe('1:05');
    expect(duration(3725)).toBe('1:02:05');
    expect(gridRef({ x: 2120, y: 4060 }, 50)).toBe('042-081');
  });

  it('describes strength as a category, never a headcount', () => {
    expect(strengthText({ kind: 'unknown' })).toBe('unknown strength');
    expect(strengthText({ kind: 'range', min: 15, max: 50 })).toBe('platoon-sized');
  });

  it('uses map directions with y growing south', () => {
    expect(compassDirection(0)).toBe('east');
    expect(compassDirection(Math.PI / 2)).toBe('south');
    expect(compassDirection((3 * Math.PI) / 4)).toBe('southwest');
    expect(compassDirection(-Math.PI / 2)).toBe('north');
  });

  it('writes a TIC and offers the reported points as coordinates', () => {
    const own = { ...contact.position, center: { x: 2000, y: 4000 } };
    const message: RadioMessage = { ...meta, kind: 'TIC', ownPosition: own, contact };
    const line = radioLine(message, 50);
    expect(line.text).toContain('Troops in contact at grid 040-080');
    expect(line.coordinates).toEqual([own.center, contact.position.center]);
  });

  it('reports strike results as the crew\'s estimate, never a true count', () => {
    const message: RadioMessage = { ...meta, kind: 'STRIKE_RESULT', aim: contact.position.center, contact, effect: 'effect-observed', assessment: null };
    expect(radioLine(message, 50).text).toBe('Strike near grid 042-081: effect observed.');
    const hit = { ...message, assessment: { estimatedCasualties: 9, destroyed: false } };
    expect(radioLine(hit, 50).text).toBe('Strike near grid 042-081: effect observed, about 9 casualties.');
    const none = { ...message, assessment: { estimatedCasualties: 0, destroyed: false } };
    expect(radioLine(none, 50).text).toBe('Strike near grid 042-081: effect observed, no casualties seen.');
    const kill = { ...message, assessment: { estimatedCasualties: 12, destroyed: true } };
    expect(radioLine(kill, 50).text).toContain('target destroyed');
    const miss = { ...message, effect: 'no-effect-observed' as const };
    expect(radioLine(miss, 50).text).toBe('Strike near grid 042-081: no effect observed.');
  });

  it('previews a forwarded contact with its real source, confidence and age', () => {
    const marker = { contact, ageSeconds: 190, key: 'k', viaAircraft: true } as unknown as ContactMarker;
    expect(forwardPreview(marker, ['F-N'], names, 50)).toBe(
      'Viper 2-1, Air Control. RECON-1 reports platoon-sized hostile infantry, moving southwest near grid 042-081. ' +
        'medium confidence, observed 3 minutes ago.',
    );
  });
});

describe('map overlays', () => {
  it('shows the grid under the cursor, and nothing off the map', () => {
    expect(cursorGrid({ x: 2525, y: 2625 }, 5000, 50)).toBe('Grid 050-052');
    expect(cursorGrid({ x: -1, y: 100 }, 5000, 50)).toBeNull();
    expect(cursorGrid({ x: 100, y: 5000 }, 5000, 50)).toBeNull();
  });

  it('picks a round scale bar length that fits', () => {
    expect(scaleBarMeters(0.1, 140)).toBe(1000);
    expect(scaleBarMeters(0.06, 140)).toBe(2000);
    expect(scaleBarMeters(0.6, 140)).toBe(200);
    expect(scaleBarMeters(1.2, 140)).toBe(100);
  });

  it('writes a scale bar length in sensible units', () => {
    expect(distanceText(500)).toBe('500 m');
    expect(distanceText(1000)).toBe('1 km');
    expect(distanceText(2000)).toBe('2 km');
  });
});

describe('radio triage', () => {
  const parameters = { repeatContactSeconds: 300, repeatContactMeters: 300 };
  const meta = { id: 'M-1' as MessageId, senderId: 'F-A', observedAt: 0, sentAt: 0 };
  const contactReport = (x: number, receivedAt: number, max = 14): RadioMessage => ({
    ...meta,
    receivedAt,
    kind: 'CONTACT_REPORT',
    contact: {
      contactId: 'C-1' as ContactId,
      provenance: { sourceId: 'F-A', observedAt: 0 },
      identification: 'hostile',
      position: { center: { x, y: 0 }, sigmaMeters: 30, headingRad: null, speedMps: null, observedAt: 0 },
      strength: { kind: 'range', min: 6, max },
      kind: 'infantry',
      activity: 'stationary',
      confidence: 'medium',
      observedWeapons: [],
    },
  });

  it('keeps position reports out of the main view and puts a TIC at the top', () => {
    const ownPosition = { center: { x: 0, y: 0 }, sigmaMeters: 30, headingRad: null, speedMps: null, observedAt: 0 };
    const position: RadioMessage = { ...meta, receivedAt: 0, kind: 'POSITION_REPORT', position: ownPosition };
    expect(triage(position, [], parameters).level).toBe('routine');
    expect(triage({ ...meta, receivedAt: 0, kind: 'TIC', ownPosition, contact: null }, [], parameters).level).toBe('urgent');
  });

  it('shows a first sighting, and not a repeat of it', () => {
    const first = triage(contactReport(0, 100), [], parameters);
    expect(first.level).toBe('main');
    expect(triage(contactReport(100, 150), first.heard, parameters).level).toBe('routine');
  });

  it('shows a repeat that says the enemy is stronger', () => {
    const first = triage(contactReport(0, 100), [], parameters);
    expect(triage(contactReport(100, 150, 50), first.heard, parameters).level).toBe('main');
  });

  it('shows a sighting somewhere else, or after a long silence', () => {
    const first = triage(contactReport(0, 100), [], parameters);
    expect(triage(contactReport(1000, 150), first.heard, parameters).level).toBe('main');
    expect(triage(contactReport(0, 500), first.heard, parameters).level).toBe('main');
  });
});
