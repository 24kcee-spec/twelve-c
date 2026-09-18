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
  // `selected`'s own flat-share projection schedule. Previously every tile
  // read `selected.result_json.schedule[i]`, so viewing a QPD3 calculation
  // showed QPD1/QPD2's tiles with QPD3's own (always-zero-paid) projected
  // figures instead of QPD1/QPD2's real net_payable/actual_paid - which is
  // exactly how a QPD3 calculation could make QPD1/QPD2 look unpaid even
  // when they were never calculated or when they'd genuinely been settled.
  // See lib/qpdStatus.ts for the full explanation.
  const obligationsByQuarter = new Map(
    evaluatedQuarterObligations(calculations, selected.tax_year).map((o) => [o.quarter, o])
  );
  const allQuartersCalculated = [1, 2, 3, 4].every((q) => obligationsByQuarter.has(q));

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((quarter) => {
          const meta = QUARTER_DATES[quarter - 1];
          const obligation = obligationsByQuarter.get(quarter);

          if (!obligation) {
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

          // Safe: obligationsByQuarter is built straight from `calculations`,
          // so a matching record always exists for every obligation.
          const calc = calculations.find((c) => c.id === obligation.calculationId)!;
          const paid = obligation.paid;
          const overdue = !paid && obligation.dueDate < today;
          const due = !paid && !overdue && obligation.dueDate >= today;
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
                {meta.short} · {percent(calc.result_json.cumulative_percentage)} cumulative
              </p>
              <p className="mt-2 font-mono text-sm text-ink">
                {paid ? money(obligation.usdOwed, "USD") : money(obligation.usdBalance, "USD")}
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
