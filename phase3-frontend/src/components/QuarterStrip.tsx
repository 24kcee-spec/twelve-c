"use client";

import Link from "next/link";
import { money, percent } from "@/lib/format";
import { QpdCalculationOut } from "@/lib/types";
import { evaluatedQuarterObligations, QUARTER_DATES, startOfDay } from "@/lib/qpdStatus";

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

  // One obligation per quarter that genuinely has its own calculation
  // record this tax year - NEVER borrowed from another quarter's row in
  // `selected`'s own flat-share projection schedule. See lib/qpdStatus.ts
  // for the full explanation of why that used to make QPD1/QPD2 look
  // unpaid whenever QPD3 was the one being viewed.
  const obligationsByQuarter = new Map(
    evaluatedQuarterObligations(calculations, selected.tax_year).map((o) => [o.quarter, o])
  );
  const allQuartersCalculated = [1, 2, 3, 4].every((q) => obligationsByQuarter.has(q));

  return (
    <div>
      <div className="divide-y divide-line border border-ink/15 bg-surface">
        {[1, 2, 3, 4].map((quarter) => {
          const meta = QUARTER_DATES[quarter - 1];
          const obligation = obligationsByQuarter.get(quarter);

          if (!obligation) {
            return (
              <Link
                key={quarter}
                href={`/dashboard/${businessId}/new?taxYear=${selected.tax_year}&quarter=${quarter}`}
                className="flex items-center gap-3 px-4 py-3 transition duration-150 hover:bg-surface-2 sm:gap-4"
              >
                <span className="w-12 shrink-0 font-display text-base text-ink-faint sm:w-14">QPD{quarter}</span>
                <span className="min-w-0 flex-1 text-sm text-ink-faint sm:w-44 sm:flex-none">
                  {meta.short} · not yet calculated
                </span>
                <span className="hidden sm:block sm:flex-1" />
                <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-brass">Calculate &rarr;</span>
              </Link>
            );
          }

          const calc = calculations.find((c) => c.id === obligation.calculationId)!;
          const paid = obligation.paid;
          const partial = obligation.partial;
          const overdue = !paid && obligation.dueDate < today;
          const due = !paid && !overdue && obligation.dueDate >= today;
          const isSelected = calc.id === selected.id;

          let statusLabel = "Calculated";
          let statusClass = "text-zig";
          if (paid) {
            statusLabel = "Paid in full";
            statusClass = "text-seal font-semibold";
          } else if (overdue) {
            statusLabel = partial ? "Overdue · partial" : "Overdue · unpaid";
            statusClass = "text-danger font-semibold";
          } else if (due) {
            statusLabel = partial ? "Partial · balance due" : "Due now · unpaid";
            statusClass = partial ? "text-zig font-semibold" : "text-danger";
          }

          return (
            <button
              key={quarter}
              type="button"
              onClick={() => onSelectQuarter(calc)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition duration-150 sm:gap-4 ${
                isSelected ? "bg-seal-soft" : "hover:bg-surface-2"
              }`}
            >
              <span className="w-12 shrink-0 font-display text-base text-ink sm:w-14">QPD{quarter}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                <span className="text-xs text-ink-faint sm:w-44 sm:shrink-0 sm:text-sm">
                  {meta.short} &middot; {percent(calc.result_json.cumulative_percentage)} cumulative
                </span>
                <span className={`flex items-center gap-1.5 text-sm sm:flex-1 ${statusClass}`}>
                  {paid && (
                    <svg
                      className="h-3.5 w-3.5 shrink-0 rounded-full bg-seal p-[3px] text-surface"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="4"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                  {statusLabel}
                </span>
              </span>
              <span className="shrink-0 text-right font-mono tabular-nums">
                <span className="block text-sm font-semibold text-ink">
                  {paid ? money(obligation.usdOwed, "USD") : money(obligation.usdBalance, "USD")}
                </span>
                {partial && (
                  <span className="block text-[11px] text-ink-faint">
                    paid {money(obligation.usdPaid, "USD")}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {allQuartersCalculated && (
        <Link
          href={`/dashboard/${businessId}/new?taxYear=${selected.tax_year + 1}&quarter=1`}
          className="mt-3 inline-block text-sm font-semibold text-brass hover:underline"
        >
          + Start {selected.tax_year + 1}
        </Link>
      )}
    </div>
  );
}