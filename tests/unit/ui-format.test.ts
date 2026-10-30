import { describe, expect, it } from 'vitest';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import type { ContactId } from '../../src/domain/public/ground';
import type { MessageId, RadioMessage } from '../../src/domain/public/radio';
import type { ContactMarker } from '../../src/knowledge/player-view';
import { clock, compassDirection, forwardPreview, gridRef, radioLine, strengthText } from '../../src/ui/format';

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
};
const meta = { id: 'M-1' as MessageId, senderId: 'F-N', observedAt: 100, sentAt: 110, receivedAt: 130 };

describe('formatting', () => {
  it('formats the clock and grid references', () => {
    expect(clock(125)).toBe('02:05');
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

  it('reports strikes without casualty numbers', () => {
    const message: RadioMessage = { ...meta, kind: 'STRIKE_RESULT', contact, effect: 'effect-observed' };
    expect(radioLine(message, 50).text).toBe('Strike near grid 042-081: effect observed.');
  });

  it('previews a forwarded contact with its real source, confidence and age', () => {
    const marker = { contact, ageSeconds: 190, key: 'k', viaAircraft: true } as unknown as ContactMarker;
    expect(forwardPreview(marker, ['F-N'], names, 50)).toBe(
      'Viper 2-1, Air Control. RECON-1 reports platoon-sized hostile infantry, moving southwest near grid 042-081. ' +
        'medium confidence, observed 3 minutes ago.',
    );
  });
});
