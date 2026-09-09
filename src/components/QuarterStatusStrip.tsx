"use client";

import { InstalmentStatus, scheduleWithStatus } from "@/lib/scheduleStatus";
import { money } from "@/lib/format";
import { QpdResultJson } from "@/lib/types";

const STATUS_STYLE: Record<InstalmentStatus, string> = {
  paid: "border-usd/30 bg-usd-soft text-usd",
  overdue: "border-danger/30 bg-danger-soft text-danger",
  active: "border-seal bg-seal-soft text-ink ring-1 ring-inset ring-seal",
  upcoming: "border-line bg-surface text-ink-faint",
};

const STATUS_LABEL: Record<InstalmentStatus, string> = {
  paid: "Paid",
  overdue: "Overdue",
  active: "Next",
  upcoming: "Upcoming",
};

/**
 * At-a-glance Q1-Q4 strip for the Overview page - the whole point is that
 * you can tell where you stand for the year without opening the Schedule
 * tab inside ResultsPanel. Deliberately terse: four fixed cells, one
 * currency (USD, since that's what most quarter-to-quarter comparisons
 * are made in) - the tab still exists for the full USD/ZiG breakdown.
 */
export function QuarterStatusStrip({ result, taxYear }: { result: QpdResultJson; taxYear: number }) {
  const rows = scheduleWithStatus(result.schedule, taxYear);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {rows.map((inst, i) => (
        <div key={inst.label} className={`rounded-md border px-3 py-2.5 transition duration-150 ${STATUS_STYLE[inst.status]}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wide opacity-80">Q{i + 1}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
              {STATUS_LABEL[inst.status]}
            </span>
          </div>
          <div className="mt-1 font-mono text-sm tabular-nums">{money(inst.usd, "USD")}</div>
        </div>
      ))}
    </div>
  );
}
