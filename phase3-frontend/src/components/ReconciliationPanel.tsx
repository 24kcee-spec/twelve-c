"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { money, percent } from "@/lib/format";
import { BusinessCompliance, ComplianceCheck, ComplianceStatus } from "@/lib/types";

const STATUS_META: Record<ComplianceStatus, { label: string; textClass: string; barClass: string }> = {
  fully_compliant: { label: "Fully compliant", textClass: "text-usd", barClass: "bg-usd" },
  within_buffer: { label: "Within buffer", textClass: "text-seal", barClass: "bg-seal" },
  under_estimated: { label: "Under-estimated", textClass: "text-danger", barClass: "bg-danger" },
  no_tax_due: { label: "No tax due", textClass: "text-ink-faint", barClass: "bg-ink-faint" },
};

function moneyOrDash(value: number | null, currency: "USD" | "ZIG"): string {
  return value === null ? "—" : money(value, currency);
}

function CurrencyCheck({ currency, check }: { currency: "USD" | "ZIG"; check: ComplianceCheck }) {
  const meta = STATUS_META[check.status];
  const pct = check.accuracy_ratio !== null ? Math.min(Math.max(check.accuracy_ratio * 100, 0), 100) : 0;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between font-mono text-xs">
        <span className="font-semibold text-ink">{currency}</span>
        <span className={`font-semibold ${meta.textClass}`}>{meta.label.toUpperCase()}</span>
      </div>

      {check.status !== "no_tax_due" && (
        <>
          <div className="mt-3 h-1.5 w-full overflow-hidden bg-surface-2">
            <div className={`h-full ${meta.barClass}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 font-mono text-[11px] text-ink-faint">
            {percent(check.accuracy_ratio ?? 0, 1)} remitted of {money(check.reference_tax, currency)}
          </p>
        </>
      )}

      <p className="mt-2 text-sm text-ink-soft">{check.message}</p>

      {/* Framed explicitly as a ceiling/worst-case, never presented as an
          actual bill - ZIMRA has discretion on what's actually charged. */}
      {check.max_penalty_exposure > 0 && (
        <p className="mt-2 font-mono text-xs text-danger">
          Max exposure (ceiling, not a bill): {money(check.max_penalty_exposure, currency)}
        </p>
      )}
    </div>
  );
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
          SECTION 72(11) · YEAR-END POSITION · {taxYear}
        </div>
        <p className="mt-2 text-sm text-ink-faint">
          Run a QPD calculation for {taxYear} to see your Section 72(11) compliance position.
        </p>
      </div>
    );
  }

  const isFinal = data.usd?.is_final ?? data.zig?.is_final ?? false;
  const overallMeta = data.overall_status ? STATUS_META[data.overall_status] : null;

  return (
    <div className="border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-6 sm:py-4">
        <div className="font-mono text-[10px] tracking-wide text-ink-faint">
          SECTION 72(11) · YEAR-END POSITION · {taxYear}
        </div>
        {overallMeta && (
          <span className={`font-mono text-[11px] font-semibold ${overallMeta.textClass}`}>
            OVERALL: {overallMeta.label.toUpperCase()}
          </span>
        )}
      </div>

      <p className="px-4 pt-3 text-xs text-ink-faint sm:px-6">
        {isFinal
          ? "Final Section 72(11) verdict, measured against the assessed liability."
          : "Early warning against the current best estimate — this is where you'd currently land, not a final verdict."}{" "}
        USD and ZiG are assessed independently and never netted against each other.
      </p>

      <div className="mt-3 grid divide-line border-t border-line sm:grid-cols-2 sm:divide-x">
        {data.usd && (
          <div className="border-b border-line sm:border-b-0">
            <CurrencyCheck currency="USD" check={data.usd} />
          </div>
        )}
        {data.zig && <CurrencyCheck currency="ZIG" check={data.zig} />}
      </div>

      <div className="border-t border-line p-4 sm:p-6">
        <div className="font-mono text-[10px] tracking-wide text-ink-faint">QUARTER-BY-QUARTER</div>
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
                    {q.cumulative_percentage !== null ? percent(q.cumulative_percentage) : "—"}
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