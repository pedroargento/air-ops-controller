import { expect, it } from 'vitest';
import { discordanceProbability, pairedStatistics } from '../../src/cli/paired-statistics';

it('uses paired differences and sample variance rather than independent proportions', () => {
  const result = pairedStatistics([1, -1, 0, 0]);
  expect(result.mean).toBe(0);
  expect(result.upper95).toBeCloseTo(1.96 * Math.sqrt(2 / 3 / 4));
  expect(result.lower95).toBeCloseTo(-result.upper95);
  expect(result.positive).toBe(1);
  expect(result.negative).toBe(1);
  expect(pairedStatistics([0, 0]).upper95).toBe(0);
  expect(() => pairedStatistics([1])).toThrow();
});

it('does not overstate rare paired outcome changes', () => {
  expect(discordanceProbability(0, 4)).toBeCloseTo(0.125);
  expect(discordanceProbability(4, 0)).toBeCloseTo(0.125);
  expect(discordanceProbability(0, 0)).toBe(1);
  expect(discordanceProbability(500, 500)).toBeCloseTo(1);
  expect(discordanceProbability(6, 16)).toBeGreaterThan(0.05);
});
