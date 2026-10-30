import { describe, expect, it } from 'vitest';
import { pcg32Next, pcg32Seed } from '../../src/rng/pcg32';
import { createRng, nextFloat, nextGaussian, nextUint32 } from '../../src/rng/streams';

describe('pcg32', () => {
  it('matches the reference demo output for seed 42, sequence 54', () => {
    const state = pcg32Seed(0, 42, 0, 54);
    const output = Array.from({ length: 6 }, () => pcg32Next(state));
    expect(output).toEqual([
      0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e,
    ]);
  });
});

describe('labeled streams', () => {
  it('reproduces the same sequence from the same seed and label', () => {
    const a = createRng(7);
    const b = createRng(7);
    const drawsA = Array.from({ length: 20 }, () => nextUint32(a, 'detect/u1/u2'));
    const drawsB = Array.from({ length: 20 }, () => nextUint32(b, 'detect/u1/u2'));
    expect(drawsA).toEqual(drawsB);
  });

  it('keeps a stream unaffected by draws from other labels', () => {
    const quiet = createRng(7);
    const noisy = createRng(7);
    for (let i = 0; i < 100; i += 1) nextUint32(noisy, 'combat/u9');
    const drawsQuiet = Array.from({ length: 20 }, () => nextUint32(quiet, 'detect/u1/u2'));
    const drawsNoisy = Array.from({ length: 20 }, () => nextUint32(noisy, 'detect/u1/u2'));
    expect(drawsNoisy).toEqual(drawsQuiet);
  });

  it('gives different labels and seeds different sequences', () => {
    const rng = createRng(7);
    const other = createRng(8);
    expect(nextUint32(rng, 'a')).not.toEqual(nextUint32(rng, 'b'));
    expect(nextUint32(createRng(7), 'a')).not.toEqual(nextUint32(other, 'a'));
  });

  it('stays JSON-serializable mid-sequence', () => {
    const rng = createRng(11);
    nextFloat(rng, 'x');
    const restored = JSON.parse(JSON.stringify(rng)) as typeof rng;
    expect(nextUint32(restored, 'x')).toEqual(nextUint32(rng, 'x'));
  });

  it('produces roughly standard normal values', () => {
    const rng = createRng(3);
    const samples = Array.from({ length: 20000 }, () => nextGaussian(rng, 'g'));
    const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
    const variance = samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) / samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
  });
});
