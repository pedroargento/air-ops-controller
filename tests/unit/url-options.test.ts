import { expect, it } from 'vitest';
import { parseSeed, parseSpeed } from '../../src/game/url-options';

it('rejects non-finite, unsupported and negative speeds before they reach the frame accumulator', () => {
  for (const raw of [null, '', 'abc', 'NaN', 'Infinity', '0', '-1', '40']) expect(parseSpeed(raw)).toBe(1);
  for (const speed of [1, 2, 4, 8]) expect(parseSpeed(String(speed))).toBe(speed);
});
it('accepts reproducible integer seeds and replaces invalid ones', () => {
  for (const raw of [null, '', ' ', 'abc', 'Infinity', '1.5', '9007199254740992']) expect(parseSeed(raw, () => 42)).toBe(42);
  expect(parseSeed('0', () => 42)).toBe(0);
  expect(parseSeed('-7', () => 42)).toBe(-7);
});
