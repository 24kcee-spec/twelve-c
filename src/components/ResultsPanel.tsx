"use client";

import { ReactNode, useState } from "react";
import { QuarterWheel, WheelSegment } from "@/components/QuarterWheel";
import { CurrencySplitBars } from "@/components/CurrencySplitBars";
import { Card, Eyebrow, TabBar } from "@/components/ui";
import { money } from "@/lib/format";
import { useCountUp } from "@/lib/useCountUp";
import { scheduleWithStatus } from "@/lib/scheduleStatus";
import { QpdResultJson } from "@/lib/types";

const DATES = ["25 Mar", "25 Jun", "25 Sep", "20 Dec"];

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

type TabId = "breakdown" | "split" | "schedule" | "payments";

export function ResultsPanel({
  result,
  taxYear,
  paymentsSlot,
}: {
  result: QpdResultJson;
  taxYear: number;
  /** Rendered inside the "Payments" tab - owned by the parent since saving
   *  payments needs page-level state (the calculation record, the API call). */
  paymentsSlot?: ReactNode;
}) {
  const [currency, setCurrency] = useState<"USD" | "ZIG">("USD");
  const [tab, setTab] = useState<TabId>("breakdown");

  const statused = scheduleWithStatus(result.schedule, taxYear);
  const wheelSegments: WheelSegment[] = statused.map((inst, i) => ({
    label: `Q${i + 1}`,
    date: DATES[i] ?? inst.label,
    percentage: inst.percentage,
    amountUsd: inst.usd,
    amountZig: inst.zig,
    status: inst.status,
  }));

  const isCapped = result.payment_ratio_usd === 0.5 && result.usd_ratio !== 0.5;

  const tabs: { id: TabId; label: string }[] = [
    { id: "breakdown", label: "Breakdown" },
    { id: "split", label: "Currency split" },
    { id: "schedule", label: "Schedule" },
    ...(paymentsSlot ? [{ id: "payments" as TabId, label: "Payments" }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-6 shadow-card-raised">
        <div className="h-[3px] w-10 rounded-full bg-seal" />
        <p className="mt-3 text-sm font-medium text-ink-faint">Net payable for this calculation</p>
        <div className="mt-2 flex flex-wrap items-end gap-6">
          <div className="font-mono text-3xl tabular-nums text-usd sm:text-4xl">{money(result.net_payable_usd, "USD")}</div>
          <div className="font-mono text-3xl tabular-nums text-zig sm:text-4xl">{money(result.net_payable_zig, "ZIG")}</div>
        </div>
      </div>

      <Card>
        <TabBar tabs={tabs} active={tab} onChange={setTab} />

        {tab === "breakdown" && (
          <div className="mt-4 fade-in-up">
            <Eyebrow>Adjusted computation</Eyebrow>
            <div className="mt-3">
              <Row label="Adjusted income" usd={result.adjusted_income_usd} zig={result.adjusted_income_zig} />
              <Row label="Adjusted deductions" usd={result.adjusted_deductions_usd} zig={result.adjusted_deductions_zig} />
              <Row label="Taxable profit" usd={result.taxable_profit_usd} zig={result.taxable_profit_zig} />
              <Row label="Tax payable" usd={result.tax_payable_usd} zig={result.tax_payable_zig} />
              <Row label="AIDS levy" usd={result.aids_levy_usd} zig={result.aids_levy_zig} />
              <Row label="Total tax due" usd={result.total_tax_usd} zig={result.total_tax_zig} />
            </div>
          </div>
        )}

        {tab === "split" && (
          <div className="mt-4 fade-in-up">
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
          </div>
        )}

        {tab === "schedule" && (
          <div className="mt-4 fade-in-up">
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
          </div>
        )}

        {tab === "payments" && paymentsSlot && <div className="mt-4 fade-in-up">{paymentsSlot}</div>}
      </Card>
    </div>
  );
}