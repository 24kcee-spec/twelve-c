"use client";

import { useState } from "react";
import { Button, ErrorNote } from "@/components/ui";
import { money } from "@/lib/format";
import { QpdCalculationOut } from "@/lib/types";

/**
 * Records what was ACTUALLY remitted to ZIMRA for THIS calculation's own
 * quarter only - one instalment, not four.
 *
 * Calls POST /confirm-payment, which writes straight to
 * actual_usd_paid/actual_zig_paid on THIS quarter's own record - the one
 * field every later quarter's calculation actually reads
 * (_sum_actual_paid_before_quarter in crud/qpd_calculation.py).
 */
export function PaymentTracker({
  calculation,
  onSubmit,
}: {
  calculation: QpdCalculationOut;
  onSubmit: (actualUsdPaid: number, actualZigPaid: number) => Promise<void>;
}) {
  const result = calculation.result_json;
  const owedUsd = result.net_payable_usd;
  const owedZig = result.net_payable_zig;

  const [usdPaid, setUsdPaid] = useState<number>(calculation.actual_usd_paid ?? owedUsd);
  const [zigPaid, setZigPaid] = useState<number>(calculation.actual_zig_paid ?? owedZig);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const usdBalance = owedUsd - usdPaid;
  const zigBalance = owedZig - zigPaid;

  function balanceInfo(balance: number, currency: "USD" | "ZIG") {
    if (balance > 0.005) return { text: `Still owes ${money(balance, currency)}`, className: "text-danger" };
    if (balance < -0.005) return { text: `Overpaid by ${money(Math.abs(balance), currency)}`, className: "text-seal" };
    return { text: "Paid in full", className: "text-seal" };
  }
  const usdInfo = balanceInfo(usdBalance, "USD");
  const zigInfo = balanceInfo(zigBalance, "ZIG");

  async function save() {
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      await onSubmit(usdPaid, zigPaid);
      setSaved(true);
    } catch {
      setError("Couldn't save this payment. Check the amounts and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-lg font-medium text-ink">
          {calculation.quarter_label || `Q${calculation.quarter}`}
        </span>
        <span className="text-xs text-ink-faint">Due {result.due_date}</span>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        Record what&apos;s actually been remitted to ZIMRA for this quarter. This is what the{" "}
        <span className="font-medium text-ink">next</span> quarter&apos;s calculation nets against - not what
        it looked like when you first calculated this one.
      </p>

      <div className="mt-4 border border-ink/15 bg-paper p-4">
        <div className="flex items-center justify-between border-b border-line pb-3 text-sm">
          <span className="text-ink-faint">Required this quarter (net payable)</span>
          <span className="font-mono tabular-nums text-ink">
            {money(owedUsd, "USD")} / {money(owedZig, "ZIG")}
          </span>
        </div>
        {(result.previous_paid_usd > 0 || result.previous_paid_zig > 0) && (
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-ink-faint">Already netted off (paid in prior quarters)</span>
            <span className="font-mono tabular-nums text-ink-faint">
              {money(result.previous_paid_usd, "USD")} / {money(result.previous_paid_zig, "ZIG")}
            </span>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-4">
          <label className="text-xs text-ink-faint">
            USD actually paid
            <input
              type="number"
              step="0.01"
              min={0}
              value={usdPaid}
              onChange={(e) => setUsdPaid(parseFloat(e.target.value) || 0)}
              className="mt-1.5 w-full border border-ink/15 bg-surface px-2.5 py-1.5 font-mono text-sm tabular-nums text-ink outline-none focus:border-brass"
            />
            <span className={`mt-1.5 block text-xs ${usdInfo.className}`}>{usdInfo.text}</span>
          </label>
          <label className="text-xs text-ink-faint">
            ZiG actually paid
            <input
              type="number"
              step="0.01"
              min={0}
              value={zigPaid}
              onChange={(e) => setZigPaid(parseFloat(e.target.value) || 0)}
              className="mt-1.5 w-full border border-ink/15 bg-surface px-2.5 py-1.5 font-mono text-sm tabular-nums text-ink outline-none focus:border-zig"
            />
            <span className={`mt-1.5 block text-xs ${zigInfo.className}`}>{zigInfo.text}</span>
          </label>
        </div>
      </div>

      <ErrorNote>{error}</ErrorNote>
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" className="w-full sm:w-auto" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Confirm payment"}
        </Button>
        {saved && !saving && <span className="text-xs font-medium text-seal">Saved.</span>}
      </div>
    </div>
  );
}