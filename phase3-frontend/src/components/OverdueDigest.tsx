"use client";

import Link from "next/link";
import { money } from "@/lib/format";
import { Business, QpdCalculationOut } from "@/lib/types";

const QUARTER_DATES = [
  { month: 2, day: 25 },
  { month: 5, day: 25 },
  { month: 8, day: 25 },
  { month: 11, day: 20 },
];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export interface DigestItem {
  business: Business;
  latestCalc: QpdCalculationOut | null;
}

export function OverdueDigest({ items }: { items: DigestItem[] }) {
  const today = startOfDay(new Date());

  const flagged = items
    .map(({ business, latestCalc }) => {
      if (!latestCalc) return null;
      const schedule = latestCalc.result_json.schedule;
      let usdOwed = 0;
      let zigOwed = 0;
      let count = 0;
      schedule.forEach((inst, i) => {
        const { month, day } = QUARTER_DATES[i];
        const due = new Date(latestCalc.tax_year, month, day);
        const paid = inst.usd_balance <= 0.01 && inst.zig_balance <= 0.01;
        if (!paid && due < today) {
          usdOwed += inst.usd_balance;
          zigOwed += inst.zig_balance;
          count += 1;
        }
      });
      if (count === 0) return null;
      return { business, usdOwed, zigOwed, count };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (flagged.length === 0) return null;

  const totalUsd = flagged.reduce((s, f) => s + f.usdOwed, 0);
  const totalZig = flagged.reduce((s, f) => s + f.zigOwed, 0);
  const totalInstalments = flagged.reduce((s, f) => s + f.count, 0);
  const worst = [...flagged].sort((a, b) => b.usdOwed - a.usdOwed)[0];

  return (
    <div className="fade-in-up relative mb-8 overflow-hidden rounded-xl bg-ink p-7 text-paper shadow-hero sm:p-8">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-seal via-[#E4C368] to-seal" />

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-paper/70">Outstanding across your businesses</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-4">
            <span className="font-display text-4xl leading-none sm:text-5xl">{money(totalUsd, "USD")}</span>
            <span className="font-mono text-lg text-paper/60">{money(totalZig, "ZIG")}</span>
          </div>
        </div>
        <span className="stamp-mark stamp-in shrink-0">
          {totalInstalments} {totalInstalments === 1 ? "instalment" : "instalments"} overdue
        </span>
      </div>

      <div className="mt-6 space-y-1 border-t border-paper/15 pt-5">
        {flagged.map((f) => (
          <Link
            key={f.business.id}
            href={`/dashboard/${f.business.id}`}
            className="flex items-center justify-between rounded-md px-2 py-2 text-sm text-paper/85 transition duration-150 hover:bg-paper/10"
          >
            <span>{f.business.name}</span>
            <span className="font-mono tabular-nums text-paper/70">
              {money(f.usdOwed, "USD")} / {money(f.zigOwed, "ZIG")}
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-paper/15 pt-5">
        <p className="max-w-[38ch] text-sm text-paper/70">
          {flagged.length === 1
            ? `${worst.business.name} is behind on ${worst.count === 1 ? "one instalment" : `${worst.count} instalments`}.`
            : `${flagged.length} businesses need attention, starting with ${worst.business.name}.`}
        </p>
        <Link
          href={`/dashboard/${worst.business.id}`}
          className="inline-flex items-center justify-center rounded-md bg-seal px-4 py-2.5 text-sm font-semibold text-[#2A1D06] transition duration-150 hover:bg-[#B68627]"
        >
          Review {worst.business.name}
        </Link>
      </div>
    </div>
  );
}
