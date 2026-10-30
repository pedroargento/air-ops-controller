import { describe, expect, it } from 'vitest';
import { advancePlayhead } from '../../src/debug/playback';

describe('debug playback', () => {
  it('plays at the chosen multiple of simulated time', () => {
    expect(advancePlayhead(0, 1000, 1, 4500)).toBe(1);
    expect(advancePlayhead(10, 500, 8, 4500)).toBe(14);
  });

  it('shows a 75-minute battle in five minutes at 15×', () => {
    expect(advancePlayhead(0, 5 * 60 * 1000, 15, 4500)).toBe(4500);
  });

  it('stops at the last frame', () => {
    expect(advancePlayhead(4499, 1000, 60, 4500)).toBe(4500);
  });
});
