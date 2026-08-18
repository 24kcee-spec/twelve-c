"use client";

import { useState } from "react";
import { InstalmentStatus, QuarterWheel, WheelSegment } from "@/components/QuarterWheel";
import { CurrencySplitBars } from "@/components/CurrencySplitBars";
import { Card, Eyebrow } from "@/components/ui";
import { money, percent } from "@/lib/format";
import { useCountUp } from "@/lib/useCountUp";
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
  const usdAnim = useCountUp(usd);
  const zigAnim = useCountUp(zig);
  return (
    <div className="flex items-center justify-between border-b border-line py-2 text-sm last:border-b-0">
      <span className="text-ink-soft">{label}</span>
      <div className="flex gap-6 font-mono tabular-nums">
        <span className="w-24 text-right text-usd">{money(usdAnim, "USD")}</span>
        <span className="w-28 text-right text-zig">{money(zigAnim, "ZIG")}</span>
      </div>
    </div>
  );
}

function AnimatedPercent({ value, colorClass }: { value: number; colorClass: string }) {
  const anim = useCountUp(value * 100);
  return <span className={`font-mono text-2xl tabular-nums ${colorClass}`}>{anim.toFixed(0)}%</span>;
}

export function ResultsPanel({ result, taxYear }: { result: QpdResultJson; taxYear: number }) {
  const [currency, setCurrency] = useState<"USD" | "ZIG">("USD");

  const today = startOfDay(new Date());
  const withDates = result.schedule.map((inst, i) => {
    const { month, day } = QUARTER_DATES[i];
    return {
      idx: i,
      date: new Date(taxYear, month, day),
      paid: inst.usd_balance <= 0.01 && inst.zig_balance <= 0.01,
    };
  });
  const overdueIdx = new Set(withDates.filter((d) => !d.paid && d.date < today).map((d) => d.idx));
  const upcoming = withDates
    .filter((d) => !d.paid && d.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const activeIndex = upcoming.length > 0 ? upcoming[0].idx : undefined;

  const wheelSegments: WheelSegment[] = result.schedule.map((inst, i) => {
    const paid = inst.usd_balance <= 0.01 && inst.zig_balance <= 0.01;
    let status: InstalmentStatus = "upcoming";
    if (paid) status = "paid";
    else if (overdueIdx.has(i)) status = "overdue";
    else if (i === activeIndex) status = "active";

    return {
      label: `Q${i + 1}`,
      date: DATES[i] ?? inst.label,
      percentage: inst.percentage,
      amountUsd: inst.usd,
      amountZig: inst.zig,
      status,
    };
  });

  const isCapped = result.payment_ratio_usd === 0.5 && result.usd_ratio !== 0.5;

  return (
    <div className="space-y-6">
      <Card className="border-2 border-ink/10 bg-ink text-surface">
        <Eyebrow className="text-surface/60">
          Net payable · Q{result.quarter} due {result.due_date} {taxYear}
        </Eyebrow>
        <div className="mt-3 flex flex-wrap items-end gap-6">
          <div>
            <div className="font-mono text-4xl tabular-nums text-usd">{money(result.net_payable_usd, "USD")}</div>
            <div className="mt-1 text-xs text-surface/60">
              {(result.cumulative_percentage * 100).toFixed(0)}% cumulative due − {money(result.previous_paid_usd, "USD")} already paid
            </div>
          </div>
          <div>
            <div className="font-mono text-4xl tabular-nums text-zig">{money(result.net_payable_zig, "ZIG")}</div>
            <div className="mt-1 text-xs text-surface/60">
              {(result.cumulative_percentage * 100).toFixed(0)}% cumulative due − {money(result.previous_paid_zig, "ZIG")} already paid
            </div>
          </div>
        </div>
        <p className="mt-4 text-xs text-surface/50">
          This is the actual amount ZIMRA expects for this quarter, netted against what you&apos;ve confirmed
          paying so far this tax year. The schedule below is a full-year projection at today&apos;s estimate,
          not a bill for future quarters — it will change if you revise your estimate next quarter.
        </p>
      </Card>

      <Card>
        <Eyebrow>Trading currency split</Eyebrow>
        <div className="mt-3 flex flex-wrap gap-8 text-sm">
          <div>
            <AnimatedPercent value={result.usd_ratio} colorClass="text-usd" />
            <div className="text-ink-faint">of trade in USD</div>
          </div>
          <div>
            <AnimatedPercent value={result.zig_ratio} colorClass="text-zig" />
            <div className="text-ink-faint">of trade in ZiG</div>
          </div>
        </div>
        <CurrencySplitBars
          rawUsd={result.usd_ratio}
          rawZig={result.zig_ratio}
          paymentUsd={result.payment_ratio_usd}
          paymentZig={result.payment_ratio_zig}
          capped={isCapped}
        />
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
          <Eyebrow>Full-year projection (at today&apos;s estimate)</Eyebrow>
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
        <div className="mt-5">
          <QuarterWheel
            segments={wheelSegments}
            currency={currency}
            totalUsd={result.total_tax_usd}
            totalZig={result.total_tax_zig}
          />
        </div>
      </Card>
    </div>
  );
}