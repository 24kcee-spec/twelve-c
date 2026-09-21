"use client";

import { useState } from "react";
import { Button, ErrorNote } from "@/components/ui";
import { money } from "@/lib/format";
import { QpdCalculationOut } from "@/lib/types";

/**
 * Records what was ACTUALLY remitted to ZIMRA for THIS calculation's own
 * quarter only - one instalment, not four.
 *
 * This replaces the old version, which edited all four rows of
 * `result_json.schedule` (a flat-share, full-YEAR PROJECTION rebuilt from
 * scratch on every calculation - see zimra_qpd/calculator.py's module
 * docstring, section 5) via POST /payments. That endpoint never touched
 * `actual_usd_paid`/`actual_zig_paid`, so nothing typed there ever reached
 * the field the NEXT quarter's calculation actually sums
 * (_sum_actual_paid_before_quarter in crud/qpd_calculation.py) - which is
 * why paying QPD1 here never "brought down" anything when QPD2 was
 * calculated, and why QPD2/QPD3's schedule kept showing earlier quarters
 * as unpaid: each new calculation gets its own fresh, zeroed schedule.
 *
 * This version calls POST /confirm-payment instead, which writes straight
 * to `actual_usd_paid`/`actual_zig_paid` on THIS quarter's own record -
 * the one field every later quarter's calculation actually reads.
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
    if (balance < -0.005) return { text: `Overpaid by ${money(Math.abs(balance), currency)}`, className: "text-usd" };
    return { text: "Paid in full", className: "text-usd" };
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
        <span className="font-medium text-ink">
          {calculation.quarter_label || `Q${calculation.quarter}`}
        </span>
        <span className="font-mono text-xs text-ink-faint">Due {result.due_date}</span>
      </div>

      <p className="mt-1 text-sm text-ink-soft">
        Record what&apos;s actually been remitted to ZIMRA for this quarter. This is what the{" "}
        <span className="font-medium text-ink">next</span> quarter&apos;s calculation nets against - not what
        it looked like when you first calculated this one.
      </p>

      <div className="mt-3 rounded border border-line p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-faint">Required this quarter (net payable)</span>
          <span className="font-mono tabular-nums text-ink">
            {money(owedUsd, "USD")} / {money(owedZig, "ZIG")}
          </span>
        </div>
        {(result.previous_paid_usd > 0 || result.previous_paid_zig > 0) && (
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-ink-faint">Already netted off (paid in prior quarters)</span>
            <span className="font-mono tabular-nums text-ink-faint">
              {money(result.previous_paid_usd, "USD")} / {money(result.previous_paid_zig, "ZIG")}
            </span>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs text-ink-soft">
            USD actually paid
            <input
              type="number"
              step="0.01"
              min={0}
              value={usdPaid}
              onChange={(e) => setUsdPaid(parseFloat(e.target.value) || 0)}
              className="mt-1 w-full rounded border border-line px-2 py-1 font-mono text-sm tabular-nums outline-none focus:border-usd"
            />
          </label>
          <label className="text-xs text-ink-soft">
            ZiG actually paid
            <input
              type="number"
              step="0.01"
              min={0}
              value={zigPaid}
              onChange={(e) => setZigPaid(parseFloat(e.target.value) || 0)}
              className="mt-1 w-full rounded border border-line px-2 py-1 font-mono text-sm tabular-nums outline-none focus:border-zig"
            />
          </label>
        </div>

        <div className="mt-2 flex gap-4 text-xs">
          <span className={usdInfo.className}>USD: {usdInfo.text}</span>
          <span className={zigInfo.className}>ZiG: {zigInfo.text}</span>
        </div>
      </div>

      <ErrorNote>{error}</ErrorNote>
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" className="w-full sm:w-auto" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Confirm payment"}
        </Button>
        {saved && !saving && <span className="text-xs text-usd">Saved.</span>}
      </div>
    </div>
  );
}
