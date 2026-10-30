import { cos, log, PI } from '../domain/public/det-math';
import { pcg32Next, pcg32Seed, type Pcg32State } from './pcg32';

// All simulation randomness goes through labeled streams, e.g.
// `detect/<observer>/<target>`, so a new draw in one subsystem can't shift
// another subsystem's results. State is plain data and is part of the state hash.
export type RngState = {
  seed: number;
  streams: Record<string, Pcg32State>;
};

export function createRng(seed: number): RngState {
  return { seed: seed >>> 0, streams: {} };
}

function fnv1a(text: string, basis: number): number {
  let hash = basis;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function stream(rng: RngState, label: string): Pcg32State {
  const existing = rng.streams[label];
  if (existing !== undefined) return existing;
  const created = pcg32Seed(
    0,
    rng.seed,
    fnv1a(label, 0x811c9dc5),
    fnv1a(label, 0x9dc5811c),
  );
  rng.streams[label] = created;
  return created;
}

export function nextUint32(rng: RngState, label: string): number {
  return pcg32Next(stream(rng, label));
}

/** Uniform in [0, 1). */
export function nextFloat(rng: RngState, label: string): number {
  return nextUint32(rng, label) / 0x100000000;
}

export function nextBool(rng: RngState, label: string, probability: number): boolean {
  return nextFloat(rng, label) < probability;
}

/** Standard normal, Box-Muller. Uses two uniform draws per call. */
export function nextGaussian(rng: RngState, label: string): number {
  const u = 1 - nextFloat(rng, label);
  const v = nextFloat(rng, label);
  return Math.sqrt(-2 * log(u)) * cos(2 * PI * v);
}

export function nextBinomial(
  rng: RngState,
  label: string,
  trials: number,
  probability: number,
): number {
  let successes = 0;
  for (let i = 0; i < trials; i += 1) {
    if (nextBool(rng, label, probability)) successes += 1;
  }
  return successes;
}
