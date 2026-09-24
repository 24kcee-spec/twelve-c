"use client";

import { money } from "@/lib/format";
import { QpdCalculationOut } from "@/lib/types";
import { evaluatedQuarterObligations, splitObligations, startOfDay } from "@/lib/qpdStatus";

function daysBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path d="M12 9v4m0 4h.01M10.3 3.86 1.8 18a1.5 1.5 0 0 0 1.3 2.25h17.8a1.5 1.5 0 0 0 1.3-2.25L13.7 3.86a1.5 1.5 0 0 0-2.6 0Z" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
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
      <div className="border border-ink/15 bg-surface p-5">
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
      <div className="flex items-start gap-3 border border-l-4 border-danger bg-danger-soft p-5">
        <span className="mt-0.5 shrink-0 text-danger">
          <WarningIcon />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-danger">
            {overdue.length === 1 ? "1 instalment overdue" : `${overdue.length} instalments overdue`}
          </p>
          <p className="mt-1 font-display text-3xl text-ink sm:text-4xl">
            {money(usdOwed, "USD")} <span className="text-lg text-ink-soft">/ {money(zigOwed, "ZIG")}</span>
          </p>
          <p className="mt-3 border-t border-danger/25 pt-3 text-sm text-danger">
            {overdue.map((o) => o.label.split(" - ")[0]).join(", ")} &mdash; pay as soon as possible to limit
            interest and penalties.
          </p>
        </div>
      </div>
    );
  }

  if (upcoming.length > 0) {
    const next = upcoming[0];
    const days = daysBetween(today, next.dueDate);
    const urgent = days <= 14;
    return (
      <div
        className={`flex items-start gap-3 border border-l-4 p-5 ${
          urgent ? "border-zig bg-zig-soft" : "border-seal bg-seal-soft"
        }`}
      >
        <span className={urgent ? "mt-0.5 shrink-0 text-zig" : "mt-0.5 shrink-0 text-seal"}>
          <ClockIcon />
        </span>
        <div className="flex-1">
          <p className={urgent ? "text-sm font-semibold text-zig" : "text-sm font-semibold text-seal"}>
            Next payment, {next.label}
          </p>
          <p className="mt-1 font-display text-3xl text-ink sm:text-4xl">
            {money(next.usdBalance, "USD")} <span className="text-lg text-ink-soft">/ {money(next.zigBalance, "ZIG")}</span>
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
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 border border-l-4 border-seal bg-seal-soft p-5">
      <span className="mt-0.5 shrink-0 text-seal">
        <CheckIcon />
      </span>
      <div>
        <p className="text-sm font-semibold text-seal">All caught up</p>
        <p className="mt-1.5 text-sm text-ink-soft">
          Every calculated QPD instalment for {taxYear} is fully paid.
        </p>
      </div>
    </div>
  );
}