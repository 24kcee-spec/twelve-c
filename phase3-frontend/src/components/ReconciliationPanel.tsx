"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { money, percent } from "@/lib/format";
import { BusinessCompliance } from "@/lib/types";

function moneyOrDash(value: number | null, currency: "USD" | "ZIG"): string {
  return value === null ? "\u2014" : money(value, currency);
}

export function ReconciliationPanel({ businessId, taxYear }: { businessId: string; taxYear: number }) {
  const [data, setData] = useState<BusinessCompliance | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setData(null);

    api
      .getCompliance(businessId, taxYear)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the reconciliation view.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [businessId, taxYear]);

  if (loading) {
    return <div className="h-40 animate-pulse border border-line bg-surface" />;
  }

  if (error) {
    return (
      <div className="border border-line bg-surface p-4">
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  if (!data.has_data) {
    return (
      <div className="border border-line bg-surface p-4 sm:p-6">
        <div className="font-mono text-[10px] tracking-wide text-ink-faint">
          RECONCILIATION {"\u00B7"} {taxYear}
        </div>
        <p className="mt-2 text-sm text-ink-faint">
          Run a QPD calculation for {taxYear} to see your quarter-by-quarter reconciliation.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-line bg-surface">
      <div className="p-4 sm:p-6">
        <div className="font-mono text-[10px] tracking-wide text-ink-faint">
          QUARTER-BY-QUARTER {"\u00B7"} {taxYear}
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] tracking-wide text-ink-faint">
                <th className="py-2 pr-3 font-medium">QUARTER</th>
                <th className="py-2 pr-3 font-medium">DUE</th>
                <th className="py-2 pr-3 text-right font-medium">CUM%</th>
                <th className="py-2 pr-3 text-right font-medium">REQUIRED</th>
                <th className="py-2 pr-3 text-right font-medium">PAID</th>
                <th className="py-2 pl-3 text-right font-medium">NET DUE</th>
              </tr>
            </thead>
            <tbody>
              {data.quarters.map((q) => (
                <tr
                  key={q.quarter}
                  className={`border-b border-line/60 font-mono text-xs last:border-b-0 ${
                    !q.has_calculation ? "opacity-50" : ""
                  }`}
                >
                  <td className="py-2 pr-3 font-semibold text-ink">{q.quarter_label || `Q${q.quarter}`}</td>
                  <td className="py-2 pr-3 text-ink-faint">{q.due_date}</td>
                  <td className="py-2 pr-3 text-right text-ink-faint">
                    {q.cumulative_percentage !== null ? percent(q.cumulative_percentage) : "\u2014"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    <div className="text-ink">{moneyOrDash(q.required_cumulative_tax_usd, "USD")}</div>
                    <div className="text-ink-faint">{moneyOrDash(q.required_cumulative_tax_zig, "ZIG")}</div>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    <div className="text-ink">{moneyOrDash(q.actual_usd_paid, "USD")}</div>
                    <div className="text-ink-faint">{moneyOrDash(q.actual_zig_paid, "ZIG")}</div>
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    <div className="text-ink">{moneyOrDash(q.net_due_usd, "USD")}</div>
                    <div className="text-ink-faint">{moneyOrDash(q.net_due_zig, "ZIG")}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">
          &quot;Paid&quot; reflects the last confirmed amount for a quarter, or the calculated estimate if not
          yet confirmed. Greyed-out quarters haven&apos;t been calculated yet this tax year.
        </p>
      </div>
    </div>
  );
}