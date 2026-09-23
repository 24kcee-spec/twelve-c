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
  usdBalance: number;
  zigBalance: number;
  paid: boolean;
  calculationId: string;
}

/**
 * ROOT-CAUSE FIX for "calculating QPD3 marks QPD1/QPD2 as outstanding".
 *
 * The bug: zimra_qpd.calculate_qpd() always returns a full 4-row
 * `schedule` - a flat-share, full-YEAR PROJECTION ("if this estimate holds,
 * here's roughly how every quarter would land"), rebuilt from scratch on
 * every single call regardless of which one `quarter` it was asked to
 * compute. Every row in that fresh schedule defaults usd_paid/zig_paid to
 * 0 (see QpdInstalment in zimra_qpd/calculator.py) - nothing about
 * calculating QPD3 ever marks QPD1/QPD2 as paid, because QPD3's own
 * schedule row 0/1 is just a hypothetical "what QPD1/QPD2 would have been
 * under today's numbers", not a record of what QPD1/QPD2 actually were.
 * Several UI surfaces were reading `schedule[i]` positionally and treating
 * row i as "the true, confirmed status of calendar quarter i" - so any
 * quarter whose ZIMRA due date had already passed showed as overdue, even
 * when that quarter was never separately calculated, confirmed, or looked
 * at.
 *
 * The fix: never derive a quarter's status from another quarter's row in
 * someone else's projection. Build one obligation per quarter that
 * genuinely HAS its own calculation record for this business/tax year,
 * using that record's own net_payable_{usd,zig} (the real cumulative
 * amount due at that quarter, already netted against prior confirmed
 * payments) and actual_{usd,zig}_paid (the canonical "what was actually
 * remitted" figure - the same field ReconciliationPanel and the backend's
 * own cumulative "previous paid" sum already treat as authoritative). A
 * quarter with no calculation record for this business/tax year simply
 * produces no obligation - it is "not yet calculated", never "unpaid" or
 * "overdue". This mirrors the backend's own already-correct
 * get_tax_year_breakdown()/TaxYearBreakdown pattern (see
 * app/crud/qpd_calculation.py).
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
      // Unconfirmed defaults to the seeded net_payable figure - the same
      // "assume paid until told otherwise" convention the backend uses
      // (see QpdCalculation.actual_usd_paid docstring) - never to 0, which
      // is what the old schedule[i]-based logic effectively assumed.
      const paidUsd = calc.actual_usd_paid ?? usdOwed;
      const paidZig = calc.actual_zig_paid ?? zigOwed;
      const usdBalance = Math.max(0, usdOwed - paidUsd);
      const zigBalance = Math.max(0, zigOwed - paidZig);
      return {
        quarter: calc.quarter,
        label: calc.quarter_label || `Q${calc.quarter}`,
        taxYear: calc.tax_year,
        dueDate: quarterDueDate(calc.tax_year, calc.quarter),
        usdOwed,
        zigOwed,
        usdBalance,
        zigBalance,
        paid: usdBalance <= 0.01 && zigBalance <= 0.01,
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
