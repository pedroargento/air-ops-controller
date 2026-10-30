import { describe, expect, it } from 'vitest';
import { atan2, cos, exp, hypot, log, PI, sin } from '../../src/domain/public/det-math';

const TOLERANCE = 1e-12;

describe('deterministic math', () => {
  it('matches the built-ins closely across working ranges', () => {
    for (let i = -400; i <= 400; i += 1) {
      const x = i * 0.137;
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(TOLERANCE);
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(TOLERANCE);
    }
    for (let i = -300; i <= 40; i += 1) {
      const x = i * 0.25;
      expect(Math.abs(exp(x) - Math.exp(x)) / Math.exp(x)).toBeLessThan(TOLERANCE);
    }
    for (let i = 1; i <= 1000; i += 1) {
      const x = i * i * 0.00001;
      expect(Math.abs(log(x) - Math.log(x))).toBeLessThan(TOLERANCE);
    }
  });

  it('covers every quadrant of atan2', () => {
    for (let a = -30; a <= 30; a += 1) {
      for (let b = -30; b <= 30; b += 1) {
        if (a === 0 && b === 0) continue;
        expect(Math.abs(atan2(a * 0.7, b * 0.3) - Math.atan2(a * 0.7, b * 0.3))).toBeLessThan(TOLERANCE);
      }
    }
  });

  it('handles the edge values the simulation can reach', () => {
    expect(atan2(0, 0)).toBe(0);
    expect(exp(0)).toBe(1);
    expect(exp(-1000)).toBe(0);
    expect(log(1)).toBe(0);
    expect(hypot(3, 4)).toBe(5);
    expect(cos(0)).toBe(1);
    expect(sin(PI)).toBeCloseTo(0, 12);
    expect(() => log(0)).toThrow(/non-positive/);
  });
});
