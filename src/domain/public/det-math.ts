// Math built only from + - * / and sqrt, which IEEE 754 fixes exactly. The built-in
// Math.log, exp, sin, cos, atan2 and hypot may differ in the last digit between engines
// and even between V8 versions, and one such digit would break replay determinism.

export const PI = 3.141592653589793;
const TWO_PI = 2 * PI;
const LN2 = 0.6931471805599453;

export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** Taylor series, after reducing to |r| <= ln2 / 2. */
export function exp(x: number): number {
  if (x < -700) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 16; n += 1) {
    term = (term * r) / n;
    sum += term;
  }
  let scale = 1;
  const factor = k < 0 ? 0.5 : 2;
  for (let i = 0; i < Math.abs(k); i += 1) scale *= factor;
  return sum * scale;
}

/** Scales into [0.75, 1.5), then uses the atanh series for ln. */
export function log(x: number): number {
  if (!(x > 0)) throw new Error(`log of non-positive value: ${x}`);
  let m = x;
  let k = 0;
  while (m >= 1.5) {
    m /= 2;
    k += 1;
  }
  while (m < 0.75) {
    m *= 2;
    k -= 1;
  }
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let power = s;
  let sum = 0;
  for (let n = 1; n <= 25; n += 2) {
    sum += power / n;
    power *= s2;
  }
  return 2 * sum + k * LN2;
}

function reduceAngle(x: number): number {
  return x - TWO_PI * Math.round(x / TWO_PI);
}

export function sin(x: number): number {
  const r = reduceAngle(x);
  const r2 = r * r;
  let term = r;
  let sum = r;
  for (let n = 1; n <= 12; n += 1) {
    term = (-term * r2) / (2 * n * (2 * n + 1));
    sum += term;
  }
  return sum;
}

export function cos(x: number): number {
  const r = reduceAngle(x);
  const r2 = r * r;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 12; n += 1) {
    term = (-term * r2) / ((2 * n - 1) * (2 * n));
    sum += term;
  }
  return sum;
}

/** Halves the angle three times so the series for |z| <= 1 converges quickly. */
function atanUnit(z: number): number {
  let t = z;
  for (let i = 0; i < 3; i += 1) t = t / (1 + Math.sqrt(1 + t * t));
  const t2 = t * t;
  let power = t;
  let sum = 0;
  for (let n = 0; n <= 12; n += 1) {
    sum += (n % 2 === 0 ? power : -power) / (2 * n + 1);
    power *= t2;
  }
  return 8 * sum;
}

export function atan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  if (Math.abs(x) >= Math.abs(y)) {
    const base = atanUnit(y / x);
    if (x > 0) return base;
    return y >= 0 ? base + PI : base - PI;
  }
  return (y > 0 ? PI / 2 : -PI / 2) - atanUnit(x / y);
}
