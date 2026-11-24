import { QpdCalculationOut } from "./types";

/**
 * Calendar due dates for each QPD, by 1-indexed quarter number - matches
 * zimra_qpd.calculator.QUARTER_DUE_DATES (25 March / 25 June /
 * 25 September / 20 December).
 */
export const QUARTER_DATES: { month: number; day: number; short: string }[] = [
  { month: 2, day: 25, short: "25 Mar" },
  { month: 5, day: 25, short: "25 Jun" },
  { month: 8, day: 25, short: "25 Sep" },
  { month: 11, day: 20, short: "20 Dec" },
];

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function quarterDueDate(taxYear: number, quarter: number): Date {
  const meta = QUARTER_DATES[quarter - 1];
  return new Date(taxYear, meta.month, meta.day);
}

export interface QuarterObligation {
  quarter: number;
  label: string;
  taxYear: number;
  dueDate: Date;
  usdOwed: number;
  zigOwed: number;
  usdPaid: number;
  zigPaid: number;
  usdBalance: number;
  zigBalance: number;
  confirmed: boolean;
  partial: boolean;
  paid: boolean;
  calculationId: string;
}

/**
 * Returns what the user actually confirmed/recorded as paid for a calculation.
 * Unconfirmed calculations (`payment_confirmed_at === null`) ALWAYS resolve
 * to 0 paid - even if a legacy backend record seeded `actual_*_paid`.
 */
export function getConfirmedPaidAmounts(
  calc: Pick<QpdCalculationOut, "actual_usd_paid" | "actual_zig_paid" | "payment_confirmed_at">
): { usd: number; zig: number; confirmed: boolean } {
  if (!calc.payment_confirmed_at) {
    return { usd: 0, zig: 0, confirmed: false };
  }
  return {
    usd: calc.actual_usd_paid ?? 0,
    zig: calc.actual_zig_paid ?? 0,
    confirmed: true,
  };
}

/**
 * Builds one obligation per quarter that genuinely has its own calculation
 * record for this business/tax year, using that record's net_payable_{usd,zig}
 * and confirmed actual_{usd,zig}_paid (defaulting to 0 when unconfirmed).
 *
 * If a quarter was recalculated more than once, the most recent run wins -
 * same "latest run wins" rule the backend uses.
 */
export function evaluatedQuarterObligations(
  calculations: QpdCalculationOut[],
  taxYear: number
): QuarterObligation[] {
  const latestByQuarter = new Map<number, QpdCalculationOut>();
  for (const calc of calculations) {
    if (calc.tax_year !== taxYear) continue;
    const existing = latestByQuarter.get(calc.quarter);
    if (!existing || new Date(calc.created_at) > new Date(existing.created_at)) {
      latestByQuarter.set(calc.quarter, calc);
    }
  }

  return Array.from(latestByQuarter.values())
    .map((calc): QuarterObligation => {
      const usdOwed = calc.result_json.net_payable_usd ?? 0;
      const zigOwed = calc.result_json.net_payable_zig ?? 0;
      const { usd: usdPaid, zig: zigPaid, confirmed } = getConfirmedPaidAmounts(calc);
      const usdBalance = Math.max(0, usdOwed - usdPaid);
      const zigBalance = Math.max(0, zigOwed - zigPaid);
      const noTaxDue = usdOwed <= 0.01 && zigOwed <= 0.01;
      const paid = noTaxDue || (confirmed && usdBalance <= 0.01 && zigBalance <= 0.01);
      const partial = !paid && confirmed && (usdPaid > 0.005 || zigPaid > 0.005);
      return {
        quarter: calc.quarter,
        label: calc.quarter_label || `Q${calc.quarter}`,
        taxYear: calc.tax_year,
        dueDate: quarterDueDate(calc.tax_year, calc.quarter),
        usdOwed,
        zigOwed,
        usdPaid,
        zigPaid,
        usdBalance,
        zigBalance,
        confirmed,
        partial,
        paid,
        calculationId: calc.id,
      };
    })
    .sort((a, b) => a.quarter - b.quarter);
}

/** Splits evaluated obligations into overdue (past due, unpaid) and
 *  upcoming (not yet due, unpaid), nearest-due first. Quarters with no
 *  calculation record never appear in `obligations` at all, so they can
 *  never land in either bucket. */
export function splitObligations(
  obligations: QuarterObligation[],
  today: Date = startOfDay(new Date())
): { overdue: QuarterObligation[]; upcoming: QuarterObligation[] } {
  const overdue = obligations.filter((o) => !o.paid && o.dueDate < today);
  const upcoming = obligations
    .filter((o) => !o.paid && o.dueDate >= today)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return { overdue, upcoming };
}
