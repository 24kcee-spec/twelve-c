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

  return (
    <div className="mb-8 rounded-md border border-danger/30 bg-danger-soft p-5">
      <p className="font-mono text-xs uppercase tracking-[0.15em] text-danger">
        {totalInstalments} instalment{totalInstalments === 1 ? "" : "s"} overdue across{" "}
        {flagged.length} business{flagged.length === 1 ? "" : "es"}
      </p>
      <p className="mt-2 font-display text-2xl text-danger">
        {money(totalUsd, "USD")} / {money(totalZig, "ZIG")}
      </p>
      <div className="mt-3 space-y-1.5">
        {flagged.map((f) => (
          <Link
            key={f.business.id}
            href={`/dashboard/${f.business.id}`}
            className="flex items-center justify-between rounded px-2 py-1.5 text-sm text-danger/90 transition hover:bg-danger/10"
          >
            <span>{f.business.name}</span>
            <span className="font-mono tabular-nums">
              {money(f.usdOwed, "USD")} / {money(f.zigOwed, "ZIG")}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
