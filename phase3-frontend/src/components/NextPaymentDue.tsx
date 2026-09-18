"use client";

import { money } from "@/lib/format";
import { QpdCalculationOut } from "@/lib/types";
import { evaluatedQuarterObligations, splitObligations, startOfDay } from "@/lib/qpdStatus";

function daysBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

export function NextPaymentDue({
  calculations,
  taxYear,
}: {
  /** Every calculation for this business - NOT just the currently selected
   *  one. Each quarter's status must come from its OWN record; see
   *  lib/qpdStatus.ts for why borrowing another quarter's row is the bug
   *  this component used to have. */
  calculations: QpdCalculationOut[];
  taxYear: number;
}) {
  const today = startOfDay(new Date());
  const obligations = evaluatedQuarterObligations(calculations, taxYear);

  if (obligations.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 shadow-card-raised">
        <p className="text-sm font-medium text-ink-soft">No calculations yet</p>
        <p className="mt-1.5 text-sm text-ink-faint">
          Run a QPD calculation for {taxYear} to see what&apos;s due.
        </p>
      </div>
    );
  }

  const { overdue, upcoming } = splitObligations(obligations, today);

  if (overdue.length > 0) {
    const usdOwed = overdue.reduce((sum, o) => sum + o.usdBalance, 0);
    const zigOwed = overdue.reduce((sum, o) => sum + o.zigBalance, 0);
    return (
      <div className="rounded-xl border border-danger/30 bg-danger-soft p-6 shadow-card-raised">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-danger">Outstanding for this business</p>
            <p className="mt-1.5 font-display text-3xl text-ink sm:text-4xl">
              {money(usdOwed, "USD")} <span className="text-lg text-ink-soft">/ {money(zigOwed, "ZIG")}</span>
            </p>
          </div>
          <span className="stamp-mark stamp-in shrink-0">
            {overdue.length === 1 ? "1 instalment overdue" : `${overdue.length} instalments overdue`}
          </span>
        </div>
        <p className="mt-4 border-t border-danger/20 pt-4 text-sm text-danger">
          {overdue.map((o) => o.label.split(" - ")[0]).join(", ")} - pay as soon as possible to limit interest and penalties.
        </p>
      </div>
    );
  }

  if (upcoming.length > 0) {
    const next = upcoming[0];
    const days = daysBetween(today, next.dueDate);
    const urgent = days <= 14;
    return (
      <div
        className={`rounded-xl border p-6 shadow-card-raised ${
          urgent ? "border-zig/30 bg-zig-soft" : "border-usd/30 bg-usd-soft"
        }`}
      >
        <p className={`text-sm font-medium ${urgent ? "text-zig" : "text-usd"}`}>
          Next payment, {next.label}
        </p>
        <p className={`mt-1.5 font-display text-3xl ${urgent ? "text-zig" : "text-usd"}`}>
          {money(next.usdBalance, "USD")} <span className="text-lg opacity-70">/ {money(next.zigBalance, "ZIG")}</span>
        </p>
        <p className="mt-3 border-t border-line pt-3 text-sm text-ink-soft">
          Due{" "}
          {next.dueDate.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          {" - "}
          {days === 0 ? "due today" : `${days} day${days === 1 ? "" : "s"} away`}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-usd/30 bg-usd-soft p-6 shadow-card-raised">
      <p className="text-sm font-medium text-usd">All caught up</p>
      <p className="mt-1.5 text-sm text-ink-soft">
        Every calculated QPD instalment for {taxYear} is fully paid.
      </p>
    </div>
  );
}
