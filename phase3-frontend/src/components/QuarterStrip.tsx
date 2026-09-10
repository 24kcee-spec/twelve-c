"use client";

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

export function QuarterStrip({ calculation }: { calculation: QpdCalculationOut }) {
  const today = startOfDay(new Date());
  const schedule = calculation.result_json.schedule;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {schedule.map((inst, i) => {
        const meta = QUARTER_DATES[i];
        const date = new Date(calculation.tax_year, meta.month, meta.day);
        const paid = inst.usd_balance <= 0.01 && inst.zig_balance <= 0.01;
        const overdue = !paid && date < today;
        const due = !paid && !overdue && date >= today;

        let badgeLabel = "Upcoming";
        let badgeClass = "bg-surface-2 text-ink-faint";
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
          <div
            key={inst.label}
            className={`relative overflow-hidden rounded-md border border-line bg-surface p-4 ${
              due || overdue ? "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-seal" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-base text-ink">QPD{i + 1}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeClass}`}>
                {badgeLabel}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-ink-faint">
              {meta.short} MIDDOT {(inst.percentage * 100).toFixed(0)}% cumulative
            </p>
            <p className="mt-2 font-mono text-sm text-ink">
              {paid ? money(inst.usd, "USD") : money(inst.usd_balance, "USD")}
            </p>
          </div>
        );
      })}
    </div>
  );
}