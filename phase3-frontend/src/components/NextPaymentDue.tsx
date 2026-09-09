"use client";

import { money } from "@/lib/format";
import { QpdCalculationOut } from "@/lib/types";

const QUARTER_DATES = [
  { month: 2, day: 25 }, // Q1 - 25 March
  { month: 5, day: 25 }, // Q2 - 25 June
  { month: 8, day: 25 }, // Q3 - 25 September
  { month: 11, day: 20 }, // Q4 - 20 December
];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function instalmentDate(taxYear: number, index: number) {
  const { month, day } = QUARTER_DATES[index];
  return new Date(taxYear, month, day);
}

function daysBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

export function NextPaymentDue({ calculation }: { calculation: QpdCalculationOut }) {
  const today = startOfDay(new Date());
  const schedule = calculation.result_json.schedule;

  const withDates = schedule.map((inst, i) => ({
    ...inst,
    date: instalmentDate(calculation.tax_year, i),
    paid: inst.usd_balance <= 0.01 && inst.zig_balance <= 0.01,
  }));

  const overdue = withDates.filter((i) => !i.paid && i.date < today);
  const upcoming = withDates
    .filter((i) => !i.paid && i.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (overdue.length > 0) {
    const usdOwed = overdue.reduce((sum, i) => sum + i.usd_balance, 0);
    const zigOwed = overdue.reduce((sum, i) => sum + i.zig_balance, 0);
    return (
      <div className="relative overflow-hidden rounded-xl bg-ink p-6 text-paper shadow-hero">
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-seal via-[#E4C368] to-seal" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-paper/70">Outstanding for this business</p>
            <p className="mt-1.5 font-display text-3xl sm:text-4xl">
              {money(usdOwed, "USD")} <span className="text-lg text-paper/60">/ {money(zigOwed, "ZIG")}</span>
            </p>
          </div>
          <span className="stamp-mark stamp-in shrink-0">
            {overdue.length === 1 ? "1 instalment overdue" : `${overdue.length} instalments overdue`}
          </span>
        </div>
        <p className="mt-4 border-t border-paper/15 pt-4 text-sm text-paper/70">
          {overdue.map((i) => i.label.split(" - ")[0]).join(", ")} - pay as soon as possible to limit interest and penalties.
        </p>
      </div>
    );
  }

  if (upcoming.length > 0) {
    const next = upcoming[0];
    const days = daysBetween(today, next.date);
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
          {money(next.usd_balance, "USD")} <span className="text-lg opacity-70">/ {money(next.zig_balance, "ZIG")}</span>
        </p>
        <p className="mt-3 border-t border-line pt-3 text-sm text-ink-soft">
          Due{" "}
          {next.date.toLocaleDateString("en-GB", {
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
        Every QPD instalment for {calculation.tax_year} is fully paid.
      </p>
    </div>
  );
}
