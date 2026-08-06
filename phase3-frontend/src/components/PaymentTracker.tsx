"use client";

import { useState } from "react";
import { Button, Card, ErrorNote, Eyebrow } from "@/components/ui";
import { money } from "@/lib/format";
import { QpdCalculationOut } from "@/lib/types";

const DATES = ["25 Mar", "25 Jun", "25 Sep", "20 Dec"];

function balanceInfo(balance: number, currency: "USD" | "ZIG") {
  if (balance > 0.005) {
    return { text: `Owes ${money(balance, currency)}`, className: "text-danger" };
  }
  if (balance < -0.005) {
    return { text: `Overpaid by ${money(Math.abs(balance), currency)}`, className: "text-usd" };
  }
  return { text: "Paid in full", className: "text-usd" };
}

export function PaymentTracker({
  calculation,
  onSubmit,
}: {
  calculation: QpdCalculationOut;
  onSubmit: (usdPaid: number[], zigPaid: number[]) => Promise<void>;
}) {
  const schedule = calculation.result_json.schedule;
  const [usdPaid, setUsdPaid] = useState<number[]>(schedule.map((s) => s.usd_paid));
  const [zigPaid, setZigPaid] = useState<number[]>(schedule.map((s) => s.zig_paid));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function updateUsd(i: number, v: number) {
    setUsdPaid((prev) => prev.map((val, idx) => (idx === i ? v : val)));
  }
  function updateZig(i: number, v: number) {
    setZigPaid((prev) => prev.map((val, idx) => (idx === i ? v : val)));
  }

  async function save() {
    setError("");
    setSaving(true);
    try {
      await onSubmit(usdPaid, zigPaid);
    } catch {
      setError("Couldn't save payments. Check the amounts and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <Eyebrow>Payments made</Eyebrow>
      <p className="mt-1 text-sm text-ink-soft">
        Record what&apos;s actually been paid to ZIMRA for each instalment.
      </p>
      <div className="mt-4 space-y-3">
        {schedule.map((inst, i) => {
          const usdBalance = inst.usd - usdPaid[i];
          const zigBalance = inst.zig - zigPaid[i];
          const usdInfo = balanceInfo(usdBalance, "USD");
          const zigInfo = balanceInfo(zigBalance, "ZIG");
          return (
            <div key={inst.label} className="rounded border border-line p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-ink">
                  Q{i + 1} - {DATES[i] ?? inst.label}
                </span>
                <span className="text-ink-faint">
                  Owed {money(inst.usd, "USD")} / {money(inst.zig, "ZIG")}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="text-xs text-ink-soft">
                  USD paid
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={usdPaid[i]}
                    onChange={(e) => updateUsd(i, parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full rounded border border-line px-2 py-1 font-mono text-sm tabular-nums outline-none focus:border-usd"
                  />
                </label>
                <label className="text-xs text-ink-soft">
                  ZiG paid
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={zigPaid[i]}
                    onChange={(e) => updateZig(i, parseFloat(e.target.value) || 0)}
                    className="mt-1 w-full rounded border border-line px-2 py-1 font-mono text-sm tabular-nums outline-none focus:border-zig"
                  />
                </label>
              </div>
              <div className="mt-2 flex gap-4 text-xs">
                <span className={usdInfo.className}>USD: {usdInfo.text}</span>
                <span className={zigInfo.className}>ZiG: {zigInfo.text}</span>
              </div>
            </div>
          );
        })}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Button variant="primary" className="mt-4" onClick={save} disabled={saving}>
        {saving ? "Saving..." : "Save payments"}
      </Button>
    </Card>
  );
}
