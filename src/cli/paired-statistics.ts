/** Normal approximation for a paired mean; callers retain discordant counts for binary outcomes. */
export function pairedStatistics(differences: readonly number[]) {
  if (differences.length < 2) throw new Error('A paired interval needs at least two seeds');
  const n = differences.length;
  const mean = differences.reduce((sum, value) => sum + value, 0) / n;
  const variance = differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const margin = 1.96 * Math.sqrt(variance / n);
  return { n, mean, lower95: mean - margin, upper95: mean + margin,
    positive: differences.filter((value) => value > 0).length,
    negative: differences.filter((value) => value < 0).length };
}

/** Exact two-sided McNemar test, conditional on the number of discordant seed pairs. */
export function discordanceProbability(gained: number, lost: number): number {
  if (![gained, lost].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid discordant counts');
  const n = gained + lost;
  if (n === 0) return 1;
  // Accumulate in log space to support large batches without 2^-n underflow.
  let logTerm = -n * Math.log(2), logSum = logTerm;
  for (let k = 1; k <= Math.min(gained, lost); k++) {
    logTerm += Math.log(n - k + 1) - Math.log(k);
    const larger = Math.max(logSum, logTerm);
    logSum = larger + Math.log(Math.exp(logSum - larger) + Math.exp(logTerm - larger));
  }
  return Math.min(1, 2 * Math.exp(logSum));
}
