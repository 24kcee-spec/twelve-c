"use client";

import { ReactNode, useState } from "react";
import { InstalmentStatus } from "@/components/QuarterWheel";
import { CurrencySplitBars } from "@/components/CurrencySplitBars";
import { money, percent } from "@/lib/format";
import { useCountUp } from "@/lib/useCountUp";
import { QpdResultJson } from "@/lib/types";
import { QUARTER_DATES, startOfDay } from "@/lib/qpdStatus";

const DATES = ["25 Mar", "25 Jun", "25 Sep", "20 Dec"];

/** The schedule's other three rows are a flat-share, full-year PROJECTION,
 *  not a record of what those quarters actually were (see the "Schedule"
 *  pane below, and the module docstring in zimra_qpd/calculator.py).
 *  Only the row matching this calculation's own `quarter` has real
 *  actual-payment data behind it, so only that row ever gets a genuine
 *  paid/overdue/due verdict - the rest get a neutral "Projected" label. */
type ScheduleRowStatus = InstalmentStatus | "projected";

/** A dense two-currency ledger row. Border-bottom hairlines separate rows;
 *  `strong` marks subtotal/total rows with a real double-rule treatment. */
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
      className={`flex items-center justify-between py-2.5 text-sm ${
        strong ? "border-y-2 border-ink" : "border-b border-line"
      }`}
    >
      <span className={muted ? "text-ink-faint" : strong ? "font-semibold text-ink" : "text-ink-soft"}>
        {label}
      </span>
      <div className="flex gap-6 font-mono tabular-nums">
        <span className={`w-24 text-right text-brass ${strong ? "font-semibold" : ""}`}>{money(usdAnim, "USD")}</span>
        <span className={`w-28 text-right text-zig ${strong ? "font-semibold" : ""}`}>{money(zigAnim, "ZIG")}</span>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="pb-1.5 pt-4 text-xs font-semibold text-brass first:pt-0">{children}</div>;
}

const STATUS_META: Record<ScheduleRowStatus, { label: string; className: string; icon: "check" | "ring" }> = {
  paid: { label: "Paid", className: "text-seal font-semibold", icon: "check" },
  overdue: { label: "Overdue", className: "text-danger font-semibold", icon: "ring" },
  active: { label: "Due now", className: "text-danger", icon: "ring" },
  upcoming: { label: "Upcoming", className: "text-ink-faint", icon: "ring" },
  projected: { label: "Projected", className: "text-ink-faint", icon: "ring" },
};

function StatusIcon({ kind }: { kind: "check" | "ring" }) {
  if (kind === "check") {
    return (
      <svg
        className="inline-block h-3.5 w-3.5 rounded-full bg-seal p-[3px] text-surface"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  return <span className="inline-block h-3 w-3 rounded-full border border-ink/30" />;
}

type PaneId = "breakdown" | "split" | "schedule" | "payments";

export function ResultsPanel({
  result,
  taxYear,
  actualUsdPaid,
  actualZigPaid,
  paymentsSlot,
}: {
  result: QpdResultJson;
  taxYear: number;
  /** What's actually been confirmed as remitted for THIS calculation's own
   *  quarter (QpdCalculationOut.actual_usd_paid/actual_zig_paid) - falls
   *  back to net_payable (i.e. "assume paid until told otherwise", the
   *  same convention the backend uses) when not supplied. Used ONLY to
   *  status the one schedule row that matches result.quarter; every other
   *  row is a projection and is never given a paid/overdue verdict. */
  actualUsdPaid?: number | null;
  actualZigPaid?: number | null;
  /** Rendered inside the "Payments" pane - owned by the parent since
   *  saving payments needs page-level state (the calculation record, the
   *  API call). */
  paymentsSlot?: ReactNode;
}) {
  const [pane, setPane] = useState<PaneId>("breakdown");

  const today = startOfDay(new Date());

  // Only THIS calculation's own quarter has real, actual-payment-backed
  // status - see the ScheduleRowStatus comment above.
  const currentQuarterIdx = result.quarter - 1;
  const currentMeta = QUARTER_DATES[currentQuarterIdx];
  const currentDueDate = new Date(taxYear, currentMeta.month, currentMeta.day);
  const paidUsd = actualUsdPaid ?? result.net_payable_usd;
  const paidZig = actualZigPaid ?? result.net_payable_zig;
  const currentBalanceUsd = Math.max(0, result.net_payable_usd - paidUsd);
  const currentBalanceZig = Math.max(0, result.net_payable_zig - paidZig);
  const currentPaid = currentBalanceUsd <= 0.01 && currentBalanceZig <= 0.01;
  const currentOverdue = !currentPaid && currentDueDate < today;

  let currentStatus: ScheduleRowStatus = "upcoming";
  if (currentPaid) currentStatus = "paid";
  else if (currentOverdue) currentStatus = "overdue";
  else currentStatus = "active";

  const scheduleRows = result.schedule.map((inst, i) => {
    const isCurrentQuarter = i === currentQuarterIdx;
    return {
      label: `Q${i + 1}`,
      date: DATES[i] ?? inst.label,
      percentage: inst.percentage,
      amountUsd: inst.usd,
      amountZig: inst.zig,
      status: isCurrentQuarter ? currentStatus : ("projected" as ScheduleRowStatus),
    };
  });

  const isCapped = result.payment_ratio_usd === 0.5 && result.usd_ratio !== 0.5;

  const panes: { id: PaneId; code: string; label: string }[] = [
    { id: "breakdown", code: "W1", label: "Breakdown" },
    { id: "split", code: "W2", label: "Currency split" },
    { id: "schedule", code: "W3", label: "Schedule" },
    ...(paymentsSlot ? [{ id: "payments" as PaneId, code: "W4", label: "Payments" }] : []),
  ];

  return (
    <div className="border border-ink/15 bg-surface">
      {/* Stat header - the "net payable" figures, plus a real progress bar
          under Cumulative instead of a bare number. */}
      <div className="grid grid-cols-2 divide-x divide-line border-b border-ink/15 sm:grid-cols-3">
        <div className="px-4 py-3 sm:px-5 sm:py-4">
          <div className="text-xs text-ink-faint">Net payable, USD</div>
          <div className="mt-1 font-display text-2xl font-medium tabular-nums text-brass">
            {money(result.net_payable_usd, "USD")}
          </div>
        </div>
        <div className="px-4 py-3 sm:px-5 sm:py-4">
          <div className="text-xs text-ink-faint">Net payable, ZiG</div>
          <div className="mt-1 font-display text-2xl font-medium tabular-nums text-zig">
            {money(result.net_payable_zig, "ZIG")}
          </div>
        </div>
        <div className="col-span-2 border-t border-ink/15 px-4 py-3 sm:col-span-1 sm:border-l sm:border-t-0 sm:px-5 sm:py-4">
          <div className="text-xs text-ink-faint">Cumulative target reached</div>
          <div className="mt-1 font-display text-2xl font-medium tabular-nums text-ink">
            {percent(result.cumulative_percentage)}
          </div>
          <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-ink"
              style={{ width: `${Math.min(100, result.cumulative_percentage * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Working-paper folio: W1-W4 index instead of pill tabs. */}
      <div className="flex flex-col sm:flex-row">
        <div className="flex shrink-0 divide-x divide-ink/15 border-b border-ink/15 sm:w-44 sm:flex-col sm:divide-x-0 sm:divide-y sm:border-b-0 sm:border-r">
          {panes.map((pn) => (
            <button
              key={pn.id}
              type="button"
              onClick={() => setPane(pn.id)}
              className={`flex flex-1 items-baseline gap-2 px-4 py-3 text-left text-sm font-medium transition duration-150 sm:border-l-2 ${
                pane === pn.id
                  ? "bg-surface-2 text-ink sm:border-l-brass"
                  : "text-ink-faint hover:text-ink-soft sm:border-l-transparent"
              }`}
            >
              <span className="font-mono text-[11px] text-ink-faint">{pn.code}</span>
              {pn.label}
            </button>
          ))}
        </div>

        <div className="flex-1 p-4 sm:p-5">
          {pane === "breakdown" && (
            <div className="fade-in-up">
              <div className="mb-1 flex items-center justify-between text-xs text-ink-faint">
                <span>Line item</span>
                <div className="flex gap-6">
                  <span className="w-24 text-right">USD</span>
                  <span className="w-28 text-right">ZiG</span>
                </div>
              </div>
              <div>
                <SectionLabel>Income</SectionLabel>
                <Row label="Adjusted income" usd={result.adjusted_income_usd} zig={result.adjusted_income_zig} />
                <SectionLabel>Deductions</SectionLabel>
                <Row
                  label="Adjusted deductions"
                  usd={result.adjusted_deductions_usd}
                  zig={result.adjusted_deductions_zig}
                  muted
                />
                <SectionLabel>Computation</SectionLabel>
                <Row label="Taxable profit" usd={result.taxable_profit_usd} zig={result.taxable_profit_zig} strong />
                <Row label="Tax payable" usd={result.tax_payable_usd} zig={result.tax_payable_zig} muted />
                <Row label="AIDS levy" usd={result.aids_levy_usd} zig={result.aids_levy_zig} muted />
                <Row label="Total tax due" usd={result.total_tax_usd} zig={result.total_tax_zig} strong />
              </div>
            </div>
          )}

          {pane === "split" && (
            <div className="fade-in-up">
              <CurrencySplitBars
                rawUsd={result.usd_ratio}
                rawZig={result.zig_ratio}
                paymentUsd={result.payment_ratio_usd}
                paymentZig={result.payment_ratio_zig}
                capped={isCapped}
              />
            </div>
          )}

          {pane === "schedule" && (
            <div className="fade-in-up">
              <div className="mb-2 text-xs text-ink-faint">Full-year projection, at today&apos;s estimate</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink/15 text-left text-xs text-ink-faint">
                      <th className="py-2 pr-3 font-medium">Qtr</th>
                      <th className="py-2 pr-3 font-medium">Due</th>
                      <th className="py-2 pr-3 font-medium">Cumulative</th>
                      <th className="py-2 pr-3 text-right font-medium">USD</th>
                      <th className="py-2 pr-3 text-right font-medium">ZiG</th>
                      <th className="py-2 pl-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleRows.map((row) => {
                      const meta = STATUS_META[row.status];
                      return (
                        <tr key={row.label} className="border-b border-line last:border-b-0">
                          <td className="py-2.5 pr-3 text-ink">{row.label}</td>
                          <td className="py-2.5 pr-3 text-ink-faint">{row.date}</td>
                          <td className="py-2.5 pr-3">
                            <span className="mr-2 inline-block h-[5px] w-12 overflow-hidden rounded-full bg-line align-middle">
                              <span
                                className="block h-full bg-seal"
                                style={{ width: `${Math.min(100, row.percentage * 100)}%` }}
                              />
                            </span>
                            <span className="tabular-nums text-ink-faint">{percent(row.percentage)}</span>
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-brass">{money(row.amountUsd, "USD")}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums text-zig">{money(row.amountZig, "ZIG")}</td>
                          <td className={`py-2.5 pl-3 ${meta.className}`}>
                            <StatusIcon kind={meta.icon} /> <span className="align-middle">{meta.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {pane === "payments" && paymentsSlot && <div className="fade-in-up">{paymentsSlot}</div>}
        </div>
      </div>
    </div>
  );
}