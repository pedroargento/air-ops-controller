// PCG32 (pcg_oneseq-style 64-bit state, 32-bit output) using 32-bit limbs,
// so that generator state stays plain JSON-serializable numbers.

export type Pcg32State = {
  stateHi: number;
  stateLo: number;
  incHi: number;
  incLo: number;
};

const MULT_HI = 0x5851f42d;
const MULT_LO = 0x4c957f2d;

function mulWide(a: number, b: number): readonly [hi: number, lo: number] {
  const a0 = a & 0xffff;
  const a1 = a >>> 16;
  const b0 = b & 0xffff;
  const b1 = b >>> 16;
  let t = a0 * b0;
  const w0 = t & 0xffff;
  let k = t >>> 16;
  t = a1 * b0 + k;
  const w1 = t & 0xffff;
  const w2 = t >>> 16;
  t = a0 * b1 + w1;
  k = t >>> 16;
  return [(a1 * b1 + w2 + k) >>> 0, ((t << 16) | w0) >>> 0];
}

function advance(s: Pcg32State): void {
  const [hi, lo] = mulWide(s.stateLo, MULT_LO);
  const productHi =
    (hi + Math.imul(s.stateHi, MULT_LO) + Math.imul(s.stateLo, MULT_HI)) >>> 0;
  const sumLo = lo + s.incLo;
  s.stateLo = sumLo >>> 0;
  s.stateHi = (productHi + s.incHi + (sumLo > 0xffffffff ? 1 : 0)) >>> 0;
}

export function pcg32Next(s: Pcg32State): number {
  const hi = s.stateHi;
  const lo = s.stateLo;
  advance(s);
  const shiftedHi = hi >>> 18;
  const shiftedLo = ((lo >>> 18) | (hi << 14)) >>> 0;
  const xorHi = hi ^ shiftedHi;
  const xorLo = lo ^ shiftedLo;
  const xorshifted = ((xorLo >>> 27) | (xorHi << 5)) >>> 0;
  const rot = hi >>> 27;
  return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
}

export function pcg32Seed(
  seedHi: number,
  seedLo: number,
  seqHi: number,
  seqLo: number,
): Pcg32State {
  const incLo = ((seqLo << 1) | 1) >>> 0;
  const incHi = ((seqHi << 1) | (seqLo >>> 31)) >>> 0;
  const s: Pcg32State = { stateHi: 0, stateLo: 0, incHi, incLo };
  advance(s);
  const sumLo = s.stateLo + (seedLo >>> 0);
  s.stateLo = sumLo >>> 0;
  s.stateHi = (s.stateHi + (seedHi >>> 0) + (sumLo > 0xffffffff ? 1 : 0)) >>> 0;
  advance(s);
  return s;
}
