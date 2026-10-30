import { describe, expect, it } from 'vitest';
import { canonicalJson, hashState } from '../../src/domain/public/hash';

describe('state hash', () => {
  it('ignores key and Map insertion order', () => {
    expect(hashState({ a: 1, b: { c: 2, d: 3 } })).toEqual(
      hashState({ b: { d: 3, c: 2 }, a: 1 }),
    );
    expect(hashState(new Map([['x', 1], ['y', 2]]))).toEqual(
      hashState(new Map([['y', 2], ['x', 1]])),
    );
  });

  it('preserves array order and detects value changes', () => {
    expect(hashState([1, 2])).not.toEqual(hashState([2, 1]));
    expect(hashState({ a: 1 })).not.toEqual(hashState({ a: 1.0000001 }));
  });

  it('omits undefined fields', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toEqual('{"b":1}');
  });

  it('rejects non-finite numbers', () => {
    expect(() => hashState({ a: Number.NaN })).toThrow(/Non-finite/);
  });
});
