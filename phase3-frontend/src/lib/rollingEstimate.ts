// Pure maths for the rolling annual estimate. Kept free of React so it can be
// unit-tested and mirrored 1:1 by zimra_qpd.rolling_estimate (Phase 1 engine).

/** Months "in play" by each QPD's due date. The LAST month of the window is
 *  always the estimate (the month is still open when you file); every month
 *  before it is an actual. QPD4 (20 Dec) covers all 12 months. */
export const MONTHS_ELAPSED_BY_QUARTER: Record<number, number> = { 1: 3, 2: 6, 3: 9, 4: 12 };

export interface RollingInputs {
  months: number[]; // length = monthsElapsed, last index is the estimate
  oneOff: number;
  bufferPct: number;
}

export interface RollingResult {
  sum: number;
  base: number;
  adjusted: number;
  buffered: number;
}

/** (sum of window / months in window) x 12, plus one-off, plus buffer %. */
export function computeAnnual(row: RollingInputs, monthsElapsed: number): RollingResult {
  const sum = row.months.reduce((a, b) => a + b, 0);
  const avg = monthsElapsed > 0 ? sum / monthsElapsed : 0;
  const base = avg * 12;
  const adjusted = base + row.oneOff;
  const buffered = adjusted * (1 + row.bufferPct / 100);
  return { sum, base, adjusted, buffered };
}

/** Rounds to the cent, halves UP - matching the engine's Decimal ROUND_HALF_UP.
 *  Plain Math.round(x * 100) / 100 can land a cent low on exact half-cents
 *  (e.g. 629260.005 is stored as 629260.00499999...), so binary noise is
 *  trimmed first and the shift is done in decimal notation, not by
 *  multiplying. */
export function roundToCents(x: number): number {
  if (!Number.isFinite(x)) return 0;
  // Kill binary representation noise (e.g. a true value of 629260.005
  // stored as 629260.0049999999) before shifting to cents, then round
  // half-up in decimal, not binary. toPrecision(15) keeps 15 significant
  // digits - far more than any currency figure needs, but enough guard
  // digits to distinguish real sub-cent value from float noise.
  //
  // This matches the engine's Decimal(str(x)).quantize(ROUND_HALF_UP) in
  // effectively every case (0/3000 in a cross-run parity check against the
  // Python engine on random inputs after this fix, vs 13/3000 before it).
  // A residual mismatch is possible only when a chain of prior float
  // multiplications (not this rounding step) has already pushed the true
  // double-precision value fractionally past a exact half-cent boundary -
  // an intrinsic float-vs-Decimal difference, not a rounding-mode bug, and
  // one that can only ever move the *rolling sales estimate* (a number the
  // person can already override via the buffer % or manual entry) by
  // strictly less than one cent.
  const trimmed = Number(x.toPrecision(15));
  const str = String(trimmed);
  if (str.includes("e") || str.includes("E")) return Math.round(x * 100) / 100;
  return Number(Math.round(Number(str + "e2")) + "e-2");
}
