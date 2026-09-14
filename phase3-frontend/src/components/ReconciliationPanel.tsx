"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, Eyebrow } from "@/components/ui";
import { money, percent } from "@/lib/format";
import { BusinessCompliance, ComplianceCheck, ComplianceStatus } from "@/lib/types";

const STATUS_META: Record<ComplianceStatus, { label: string; badgeClass: string; barClass: string }> = {
  fully_compliant: { label: "Fully compliant", badgeClass: "bg-usd-soft text-usd", barClass: "bg-usd" },
  within_buffer: { label: "Within buffer", badgeClass: "bg-seal-soft text-seal", barClass: "bg-seal" },
  under_estimated: { label: "Under-estimated", badgeClass: "bg-danger-soft text-danger", barClass: "bg-danger" },
  no_tax_due: { label: "No tax due", badgeClass: "bg-surface-2 text-ink-faint", barClass: "bg-ink-faint" },
};

function moneyOrDash(value: number | null, currency: "USD" | "ZIG"): string {
  return value === null ? "—" : money(value, currency);
}

function CurrencyCheck({ currency, check }: { currency: "USD" | "ZIG"; check: ComplianceCheck }) {
  const meta = STATUS_META[check.status];
  const pct = check.accuracy_ratio !== null ? Math.min(Math.max(check.accuracy_ratio * 100, 0), 100) : 0;

  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="font-display text-base text-ink">{currency}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.badgeClass}`}>{meta.label}</span>
      </div>

      {check.status !== "no_tax_due" && (
        <>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full rounded-full ${meta.barClass}`} style={{ width: `${pct}%` }} />
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
          Max penalty exposure (ceiling, not a bill): {money(check.max_penalty_exposure, currency)}
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
    return <div className="h-40 animate-pulse rounded-lg border border-line bg-surface" />;
  }

  if (error) {
    return (
      <Card>
        <p className="text-sm text-danger">{error}</p>
      </Card>
    );
  }

  if (!data) return null;

  if (!data.has_data) {
    return (
      <Card>
        <Eyebrow>Year-end reconciliation · {taxYear}</Eyebrow>
        <p className="mt-2 text-sm text-ink-faint">
          Run a QPD calculation for {taxYear} to see your Section 72(11) compliance position.
        </p>
      </Card>
    );
  }

  const isFinal = data.usd?.is_final ?? data.zig?.is_final ?? false;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Year-end reconciliation · {taxYear}</Eyebrow>
        {data.overall_status && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_META[data.overall_status].badgeClass}`}
          >
            Overall: {STATUS_META[data.overall_status].label}
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-ink-faint">
        {isFinal
          ? "Final Section 72(11) verdict, measured against the assessed liability."
          : "Early warning against the current best estimate — this is where you'd currently land, not a final verdict."}{" "}
        USD and ZiG are assessed independently and never netted against each other.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {data.usd && <CurrencyCheck currency="USD" check={data.usd} />}
        {data.zig && <CurrencyCheck currency="ZIG" check={data.zig} />}
      </div>

      <div className="mt-6">
        <Eyebrow>Quarter-by-quarter</Eyebrow>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="py-2 pr-3 font-medium">Quarter</th>
                <th className="py-2 pr-3 font-medium">Due</th>
                <th className="py-2 pr-3 font-medium">Cumulative %</th>
                <th className="py-2 pr-3 font-medium">Required</th>
                <th className="py-2 pr-3 font-medium">Paid</th>
                <th className="py-2 pr-3 font-medium">Net due</th>
              </tr>
            </thead>
            <tbody>
              {data.quarters.map((q) => (
                <tr
                  key={q.quarter}
                  className={`border-b border-line/60 ${!q.has_calculation ? "opacity-50" : ""}`}
                >
                  <td className="py-2 pr-3 font-display text-ink">{q.quarter_label || `Q${q.quarter}`}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-ink-faint">{q.due_date}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-ink-faint">
                    {q.cumulative_percentage !== null ? percent(q.cumulative_percentage) : "—"}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs tabular-nums">
                    <div className="text-ink">{moneyOrDash(q.required_cumulative_tax_usd, "USD")}</div>
                    <div className="text-ink-faint">{moneyOrDash(q.required_cumulative_tax_zig, "ZIG")}</div>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs tabular-nums">
                    <div className="text-ink">{moneyOrDash(q.actual_usd_paid, "USD")}</div>
                    <div className="text-ink-faint">{moneyOrDash(q.actual_zig_paid, "ZIG")}</div>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs tabular-nums">
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
    </Card>
  );
}
