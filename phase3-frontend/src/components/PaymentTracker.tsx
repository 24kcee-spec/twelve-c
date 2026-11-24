"use client";

import { useEffect, useState } from "react";
import { Button, ErrorNote, Field } from "@/components/ui";
import { money } from "@/lib/format";
import { getConfirmedPaidAmounts } from "@/lib/qpdStatus";
import { QpdCalculationOut } from "@/lib/types";

function parseNonNegative(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Inline payment recorder for THIS calculation's own quarter.
 *
 * Newly calculated quarters start unconfirmed (`payment_confirmed_at === null`),
 * so both inputs start blank (0.00 placeholder) rather than assuming full
 * payment. Saving calls `POST /confirm-payment`, updating both Overview and
 * Reconciliation views and propagating into subsequent quarters' calculations.
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

  const confirmedState = getConfirmedPaidAmounts(calculation);

  const [usdInput, setUsdInput] = useState<string>(
    confirmedState.confirmed ? String(confirmedState.usd) : ""
  );
  const [zigInput, setZigInput] = useState<string>(
    confirmedState.confirmed ? String(confirmedState.zig) : ""
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const next = getConfirmedPaidAmounts(calculation);
    setUsdInput(next.confirmed ? String(next.usd) : "");
    setZigInput(next.confirmed ? String(next.zig) : "");
  }, [calculation]);

  const usdPaid = parseNonNegative(usdInput);
  const zigPaid = parseNonNegative(zigInput);
  const usdBalance = owedUsd - usdPaid;
  const zigBalance = owedZig - zigPaid;

  const isDirty =
    !confirmedState.confirmed
      ? usdInput.trim() !== "" || zigInput.trim() !== ""
      : Math.abs(usdPaid - confirmedState.usd) > 0.001 ||
        Math.abs(zigPaid - confirmedState.zig) > 0.001;

  function balanceInfo(balance: number, currency: "USD" | "ZIG") {
    if (balance > 0.005) {
      return { text: `Still owes ${money(balance, currency)}`, className: "text-danger" };
    }
    if (balance < -0.005) {
      return { text: `Overpaid by ${money(Math.abs(balance), currency)}`, className: "text-seal" };
    }
    return { text: "Paid in full", className: "text-seal" };
  }

  const usdInfo = balanceInfo(usdBalance, "USD");
  const zigInfo = balanceInfo(zigBalance, "ZIG");

  const paidInFullSaved =
    (owedUsd <= 0.01 && owedZig <= 0.01) ||
    (confirmedState.confirmed &&
      owedUsd - confirmedState.usd <= 0.01 &&
      owedZig - confirmedState.zig <= 0.01);

  let statusChip = { text: "Not yet paid", className: "bg-danger-soft text-danger" };
  if (paidInFullSaved) {
    statusChip = { text: "Paid in full", className: "bg-seal-soft text-seal" };
  } else if (confirmedState.confirmed) {
    statusChip = { text: "Partial payment recorded", className: "bg-zig-soft text-zig" };
  }

  function fillFullDue() {
    setUsdInput(owedUsd.toFixed(2));
    setZigInput(owedZig.toFixed(2));
    setSaved(false);
    setError("");
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
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
    <form onSubmit={save} className="border-b border-ink/15 bg-paper/60 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-sm font-semibold text-ink">
            What you paid &middot; {calculation.quarter_label || `Q${calculation.quarter}`}
          </span>
          <span className={`rounded px-2 py-0.5 font-mono text-[11px] font-medium ${statusChip.className}`}>
            {statusChip.text}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-faint">
          <span>
            Net due: <span className="font-mono text-ink">{money(owedUsd, "USD")}</span> /{" "}
            <span className="font-mono text-ink">{money(owedZig, "ZIG")}</span>
          </span>
          <button
            type="button"
            onClick={fillFullDue}
            className="font-medium text-brass hover:underline"
          >
            Fill full due
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
        <div>
          <Field
            label="USD paid"
            type="number"
            step="0.01"
            min={0}
            placeholder="0.00"
            value={usdInput}
            onChange={(e) => {
              setUsdInput(e.target.value);
              setSaved(false);
            }}
            className="tabular-nums"
          />
          <span className={`mt-1 block text-xs ${usdInfo.className}`}>{usdInfo.text}</span>
        </div>

        <div>
          <Field
            label="ZiG paid"
            type="number"
            step="0.01"
            min={0}
            placeholder="0.00"
            value={zigInput}
            onChange={(e) => {
              setZigInput(e.target.value);
              setSaved(false);
            }}
            className="tabular-nums"
          />
          <span className={`mt-1 block text-xs ${zigInfo.className}`}>{zigInfo.text}</span>
        </div>

        <div className="sm:pt-6">
          <Button
            type="submit"
            variant={isDirty || !confirmedState.confirmed ? "primary" : "secondary"}
            className="w-full whitespace-nowrap sm:w-auto"
            disabled={saving}
          >
            {saving ? "Saving..." : confirmedState.confirmed ? "Update payment" : "Save payment"}
          </Button>
          {saved && !saving && (
            <span className="mt-1 block text-center text-xs font-medium text-seal sm:text-left">
              Saved &amp; synced
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </form>
  );
}