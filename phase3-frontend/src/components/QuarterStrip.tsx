"use client";

import Link from "next/link";
import { money } from "@/lib/format";
import { QpdCalculationOut } from "@/lib/types";

const QUARTER_DATES = [
  { month: 2, day: 25, short: "25 Mar" },
  { month: 5, day: 25, short: "25 Jun" },
  { month: 8, day: 25, short: "25 Sep" },
  { month: 11, day: 20, short: "20 Dec" },
];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// One most-recent calculation per quarter for this tax year, or null if
// that quarter hasn't been calculated at all yet. `calculations` is
// already ordered created_at DESC by the API, so the first match per
// quarter is the latest one - same "latest run wins" rule the backend's
// own compliance breakdown uses.
function calcForQuarter(
  calculations: QpdCalculationOut[],
  taxYear: number,
  quarter: number
): QpdCalculationOut | null {
  return calculations.find((c) => c.tax_year === taxYear && c.quarter === quarter) ?? null;
}

export function QuarterStrip({
  businessId,
  calculations,
  selected,
  onSelectQuarter,
}: {
  businessId: string;
  calculations: QpdCalculationOut[];
  selected: QpdCalculationOut;
  onSelectQuarter: (calculation: QpdCalculationOut) => void;
}) {
  const today = startOfDay(new Date());
  // Amounts/paid-status for a calculated quarter are read from the
  // CURRENTLY SELECTED calculation's own schedule (as before this
  // redesign) - each calculation's schedule already projects all four
  // quarters under that calculation's own assumptions, and PaymentTracker
  // writes confirmed payments back onto it. This only adds the "hasn't
  // been calculated yet at all" empty state on top of that, driven by
  // whether any QpdCalculation record exists for the quarter.
  const schedule = selected.result_json.schedule;
  const allQuartersCalculated = [1, 2, 3, 4].every(
    (q) => calcForQuarter(calculations, selected.tax_year, q) !== null
  );

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {schedule.map((inst, i) => {
        const quarter = i + 1;
        const meta = QUARTER_DATES[i];
        const date = new Date(selected.tax_year, meta.month, meta.day);
        const calc = calcForQuarter(calculations, selected.tax_year, quarter);

        if (!calc) {
          return (
            <Link
              key={quarter}
              href={`/dashboard/${businessId}/new?taxYear=${selected.tax_year}&quarter=${quarter}`}
              className="flex min-h-[104px] flex-col justify-between rounded-md border border-dashed border-line bg-surface/60 p-4 transition duration-150 hover:border-seal/50"
            >
              <div>
                <span className="font-display text-base text-ink-faint">QPD{quarter}</span>
                <p className="mt-1 font-mono text-[11px] text-ink-faint">{meta.short}</p>
              </div>
              <span className="font-mono text-[11px] font-semibold text-seal">+ Calculate</span>
            </Link>
          );
        }

        const paid = inst.usd_balance <= 0.01 && inst.zig_balance <= 0.01;
        const overdue = !paid && date < today;
        const due = !paid && !overdue && date >= today;
        const isSelected = calc.id === selected.id;

        let badgeLabel = "Calculated";
        let badgeClass = "bg-zig-soft text-zig";
        if (paid) {
          badgeLabel = "Paid";
          badgeClass = "bg-usd-soft text-usd";
        } else if (overdue) {
          badgeLabel = "Overdue";
          badgeClass = "bg-danger-soft text-danger";
        } else if (due) {
          badgeLabel = "Due";
          badgeClass = "bg-seal-soft text-seal";
        }

        return (
          <button
            key={quarter}
            type="button"
            onClick={() => onSelectQuarter(calc)}
            className={`relative overflow-hidden rounded-md border bg-surface p-4 text-left transition duration-150 ${
              isSelected ? "border-seal ring-1 ring-seal" : "border-line hover:border-seal/40"
            } ${due || overdue ? "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-seal" : ""}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-base text-ink">QPD{quarter}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeClass}`}>
                {badgeLabel}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-ink-faint">
              {meta.short} · {(inst.percentage * 100).toFixed(0)}% cumulative
            </p>
            <p className="mt-2 font-mono text-sm text-ink">
              {paid ? money(inst.usd, "USD") : money(inst.usd_balance, "USD")}
            </p>
          </button>
        );
      })}
      </div>
      {allQuartersCalculated && (
        <Link
          href={`/dashboard/${businessId}/new?taxYear=${selected.tax_year + 1}&quarter=1`}
          className="mt-3 inline-block font-mono text-xs font-semibold text-seal hover:underline"
        >
          + Start {selected.tax_year + 1}
        </Link>
      )}
    </div>
  );
}
