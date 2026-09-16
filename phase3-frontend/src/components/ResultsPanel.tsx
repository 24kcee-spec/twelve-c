"use client";

import { ReactNode, useState } from "react";
import { InstalmentStatus } from "@/components/QuarterWheel";
import { CurrencySplitBars } from "@/components/CurrencySplitBars";
import { TabBar } from "@/components/ui";
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

/** A dense two-currency line item row - the ledger-terminal replacement for
 *  the old rounded "card row". Border-bottom hairlines do the separating;
 *  no radius, no shadow. `strong` marks subtotal/total rows. */
function Row({
  label,
  usd,
  zig,
  strong = false,
  muted = false,
}: {
  label: string;
  usd: number;
  zig: number;
  strong?: boolean;
  muted?: boolean;
}) {
  const usdAnim = useCountUp(usd);
  const zigAnim = useCountUp(zig);
  return (
    <div
      className={`flex items-center justify-between border-b border-line py-2 text-sm last:border-b-0 ${
        strong ? "-mx-3 bg-surface-2 px-3" : ""
      }`}
    >
      <span className={muted ? "text-ink-faint" : strong ? "font-semibold text-ink" : "text-ink-soft"}>
        {label}
      </span>
      <div className="flex gap-6 font-mono tabular-nums">
        <span className={`w-24 text-right ${strong ? "font-semibold" : ""} text-usd`}>{money(usdAnim, "USD")}</span>
        <span className={`w-28 text-right ${strong ? "font-semibold" : ""} text-zig`}>{money(zigAnim, "ZIG")}</span>
      </div>
    </div>
  );
}

const STATUS_META: Record<InstalmentStatus, { label: string; className: string }> = {
  paid: { label: "PAID", className: "text-seal" },
  overdue: { label: "OVERDUE", className: "text-danger font-semibold" },
  active: { label: "DUE", className: "text-danger" },
  upcoming: { label: "—", className: "text-ink-faint" },
};

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
  const [tab, setTab] = useState<TabId>("breakdown");

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

  const scheduleRows = result.schedule.map((inst, i) => {
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

  const tabs: { id: TabId; label: string }[] = [
    { id: "breakdown", label: "Breakdown" },
    { id: "split", label: "Currency split" },
    { id: "schedule", label: "Schedule" },
    ...(paymentsSlot ? [{ id: "payments" as TabId, label: "Payments" }] : []),
  ];

  return (
    <div className="border border-line bg-surface">
      {/* Stat header - the "net payable" figure moved off a floating hero
          card and into a dense terminal-style stat row, on record with the
          rest of the sheet instead of announcing itself above it. */}
      <div className="grid grid-cols-2 divide-x divide-line border-b border-line sm:grid-cols-3">
        <div className="px-4 py-3 sm:px-5 sm:py-4">
          <div className="font-mono text-[10px] tracking-wide text-ink-faint">NET PAYABLE USD</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-usd sm:text-2xl">
            {money(result.net_payable_usd, "USD")}
          </div>
        </div>
        <div className="px-4 py-3 sm:px-5 sm:py-4">
          <div className="font-mono text-[10px] tracking-wide text-ink-faint">NET PAYABLE ZIG</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-zig sm:text-2xl">
            {money(result.net_payable_zig, "ZIG")}
          </div>
        </div>
        <div className="col-span-2 border-t border-line px-4 py-3 sm:col-span-1 sm:border-l sm:border-t-0 sm:px-5 sm:py-4">
          <div className="font-mono text-[10px] tracking-wide text-ink-faint">CUMULATIVE</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-ink sm:text-2xl">
            {percent(result.cumulative_percentage)}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <TabBar tabs={tabs} active={tab} onChange={setTab} />

        {tab === "breakdown" && (
          <div className="mt-4 fade-in-up">
            <div className="mb-2 flex items-center justify-between font-mono text-[10px] tracking-wide text-ink-faint">
              <span>LINE ITEM</span>
              <div className="flex gap-6">
                <span className="w-24 text-right">USD</span>
                <span className="w-28 text-right">ZIG</span>
              </div>
            </div>
            <div>
              <Row label="Adjusted income" usd={result.adjusted_income_usd} zig={result.adjusted_income_zig} />
              <Row
                label="Adjusted deductions"
                usd={result.adjusted_deductions_usd}
                zig={result.adjusted_deductions_zig}
                muted
              />
              <Row
                label="Taxable profit"
                usd={result.taxable_profit_usd}
                zig={result.taxable_profit_zig}
                strong
              />
              <Row label="Tax payable" usd={result.tax_payable_usd} zig={result.tax_payable_zig} muted />
              <Row label="AIDS levy" usd={result.aids_levy_usd} zig={result.aids_levy_zig} muted />
              <Row label="Total tax due" usd={result.total_tax_usd} zig={result.total_tax_zig} strong />
            </div>
          </div>
        )}

        {tab === "split" && (
          <div className="mt-4 fade-in-up">
            <div className="font-mono text-[10px] tracking-wide text-ink-faint">TRADING CURRENCY SPLIT</div>
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
            <div className="font-mono text-[10px] tracking-wide text-ink-faint">
              FULL-YEAR PROJECTION (AT TODAY&apos;S ESTIMATE)
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[10px] tracking-wide text-ink-faint">
                    <th className="py-2 pr-3 font-medium">QTR</th>
                    <th className="py-2 pr-3 font-medium">DUE</th>
                    <th className="py-2 pr-3 text-right font-medium">SHARE%</th>
                    <th className="py-2 pr-3 text-right font-medium">USD</th>
                    <th className="py-2 pr-3 text-right font-medium">ZIG</th>
                    <th className="py-2 pl-3 font-medium">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleRows.map((row) => {
                    const meta = STATUS_META[row.status];
                    return (
                      <tr
                        key={row.label}
                        className={`border-b border-line/60 font-mono text-xs last:border-b-0 ${
                          row.status === "overdue"
                            ? "bg-danger-soft/40"
                            : row.status === "active"
                            ? "bg-seal-soft/40"
                            : ""
                        }`}
                      >
                        <td className="py-2 pr-3 text-ink">{row.label}</td>
                        <td className="py-2 pr-3 text-ink-faint">{row.date}</td>
                        <td className="py-2 pr-3 text-right text-ink-faint">{percent(row.percentage)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink">{money(row.amountUsd, "USD")}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink">{money(row.amountZig, "ZIG")}</td>
                        <td className={`py-2 pl-3 ${meta.className}`}>{meta.label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "payments" && paymentsSlot && <div className="mt-4 fade-in-up">{paymentsSlot}</div>}
      </div>
    </div>
  );
}
