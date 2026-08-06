"use client";

import { useState } from "react";
import { QuarterlyRhythm } from "@/components/QuarterlyRhythm";
import { Card, Eyebrow } from "@/components/ui";
import { money, percent } from "@/lib/format";
import { QpdResultJson } from "@/lib/types";

const DATES = ["25 Mar", "25 Jun", "25 Sep", "20 Dec"];
const QUARTER_DATES = [
  { month: 2, day: 25 },
  { month: 5, day: 25 },
  { month: 8, day: 25 },
  { month: 11, day: 20 },
];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function Row({ label, usd, zig }: { label: string; usd: number; zig: number }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2 text-sm last:border-b-0">
      <span className="text-ink-soft">{label}</span>
      <div className="flex gap-6 font-mono tabular-nums">
        <span className="w-24 text-right text-usd">{money(usd, "USD")}</span>
        <span className="w-28 text-right text-zig">{money(zig, "ZIG")}</span>
      </div>
    </div>
  );
}

export function ResultsPanel({ result, taxYear }: { result: QpdResultJson; taxYear: number }) {
  const [currency, setCurrency] = useState<"USD" | "ZIG">("USD");

  const segments = result.schedule.map((inst, i) => ({
    label: `Q${i + 1}`,
    date: DATES[i] ?? inst.label,
    percentage: inst.percentage,
    amountUsd: inst.usd,
    amountZig: inst.zig,
  }));

  const today = startOfDay(new Date());
  const withDates = result.schedule.map((inst, i) => {
    const { month, day } = QUARTER_DATES[i];
    return {
      idx: i,
      date: new Date(taxYear, month, day),
      paid: inst.usd_balance <= 0.01 && inst.zig_balance <= 0.01,
    };
  });
  const overdue = withDates.find((i) => !i.paid && i.date < today);
  const upcoming = withDates
    .filter((i) => !i.paid && i.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const activeIndex = overdue ? overdue.idx : upcoming.length > 0 ? upcoming[0].idx : undefined;

  return (
    <div className="space-y-6">
      <Card>
        <Eyebrow>Trading currency split</Eyebrow>
        <div className="mt-3 flex gap-8 text-sm">
          <div>
            <div className="font-mono text-2xl text-usd tabular-nums">{percent(result.usd_ratio)}</div>
            <div className="text-ink-faint">of trade in USD</div>
          </div>
          <div>
            <div className="font-mono text-2xl text-zig tabular-nums">{percent(result.zig_ratio)}</div>
            <div className="text-ink-faint">of trade in ZiG</div>
          </div>
          {(result.payment_ratio_usd === 0.5 && result.usd_ratio !== 0.5) && (
            <div className="flex items-center rounded bg-paper px-3 py-2 text-xs text-ink-faint">
              Public Notice 71 cap applied — USD is dominant, so the payment
              ratio is capped at 50/50 rather than the raw {percent(result.usd_ratio, 1)}.
            </div>
          )}
        </div>
      </Card>

      <Card>
        <Eyebrow>Adjusted computation</Eyebrow>
        <div className="mt-3">
          <Row label="Adjusted income" usd={result.adjusted_income_usd} zig={result.adjusted_income_zig} />
          <Row label="Adjusted deductions" usd={result.adjusted_deductions_usd} zig={result.adjusted_deductions_zig} />
          <Row label="Taxable profit" usd={result.taxable_profit_usd} zig={result.taxable_profit_zig} />
          <Row label="Tax payable" usd={result.tax_payable_usd} zig={result.tax_payable_zig} />
          <Row label="AIDS levy" usd={result.aids_levy_usd} zig={result.aids_levy_zig} />
          <Row label="Total tax due" usd={result.total_tax_usd} zig={result.total_tax_zig} />
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <Eyebrow>QPD schedule</Eyebrow>
          <div className="flex overflow-hidden rounded border border-line text-xs">
            <button
              onClick={() => setCurrency("USD")}
              className={`px-3 py-1 ${currency === "USD" ? "bg-usd text-surface" : "text-ink-soft"}`}
            >
              USD
            </button>
            <button
              onClick={() => setCurrency("ZIG")}
              className={`px-3 py-1 ${currency === "ZIG" ? "bg-zig text-surface" : "text-ink-soft"}`}
            >
              ZiG
            </button>
          </div>
        </div>
        <div className="mt-4">
          <QuarterlyRhythm segments={segments} currency={currency} showAmounts activeIndex={activeIndex} />
        </div>
      </Card>
    </div>
  );
}