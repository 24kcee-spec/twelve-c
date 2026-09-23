"use client";

import Link from "next/link";
import { money } from "@/lib/format";
import { Business, QpdCalculationOut } from "@/lib/types";
import { evaluatedQuarterObligations, splitObligations, startOfDay } from "@/lib/qpdStatus";

export interface DigestItem {
  business: Business;
  calculations: QpdCalculationOut[];
}

export function OverdueDigest({ items }: { items: DigestItem[] }) {
  const today = startOfDay(new Date());

  const flagged = items
    .map(({ business, calculations }) => {
      if (calculations.length === 0) return null;
      // Scoped to the most recent tax year this business has calculated -
      // same scope the old logic used (it only ever looked at the latest
      // calculation). Only quarters with their OWN record for that year
      // ever count - a calculation for QPD3 can never flag QPD1/QPD2 as
      // overdue unless QPD1/QPD2 were themselves calculated. See
      // lib/qpdStatus.ts for the full root-cause explanation.
      const taxYear = calculations[0].tax_year;
      const { overdue } = splitObligations(evaluatedQuarterObligations(calculations, taxYear), today);
      if (overdue.length === 0) return null;
      const usdOwed = overdue.reduce((s, o) => s + o.usdBalance, 0);
      const zigOwed = overdue.reduce((s, o) => s + o.zigBalance, 0);
      return { business, usdOwed, zigOwed, count: overdue.length };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (flagged.length === 0) return null;

  const totalUsd = flagged.reduce((s, f) => s + f.usdOwed, 0);
  const totalZig = flagged.reduce((s, f) => s + f.zigOwed, 0);
  const totalInstalments = flagged.reduce((s, f) => s + f.count, 0);
  const worst = [...flagged].sort((a, b) => b.usdOwed - a.usdOwed)[0];

  return (
    <div className="fade-in-up relative mb-8 overflow-hidden rounded-xl bg-ink p-7 text-paper shadow-hero sm:p-8">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-seal via-[#9EC494] to-seal" />

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
          className="inline-flex items-center justify-center rounded-md bg-seal px-4 py-2.5 text-sm font-semibold text-[#14261C] transition duration-150 hover:bg-[#28442C]"
        >
          Review {worst.business.name}
        </Link>
      </div>
    </div>
  );
}
