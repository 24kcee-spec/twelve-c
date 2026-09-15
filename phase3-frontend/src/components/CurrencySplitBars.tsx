"use client";

import { useEffect, useState } from "react";
import { percent } from "@/lib/format";

function Bar({
  usdPct,
  zigPct,
  mounted,
}: {
  usdPct: number;
  zigPct: number;
  mounted: boolean;
}) {
  return (
    <div className="flex h-5 w-full overflow-hidden bg-line/40">
      <div
        className="h-full bg-usd"
        style={{
          width: mounted ? `${usdPct * 100}%` : "0%",
          transition: "width 700ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
      <div
        className="h-full bg-zig"
        style={{
          width: mounted ? `${zigPct * 100}%` : "0%",
          transition: "width 700ms cubic-bezier(0.22, 1, 0.36, 1) 60ms",
        }}
      />
    </div>
  );
}

export function CurrencySplitBars({
  rawUsd,
  rawZig,
  paymentUsd,
  paymentZig,
  capped,
}: {
  rawUsd: number;
  rawZig: number;
  paymentUsd: number;
  paymentZig: number;
  capped: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="mt-3 space-y-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between font-mono text-[11px] text-ink-faint">
          <span>RAW TRADE SPLIT</span>
          <span className="tabular-nums">
            {percent(rawUsd, 1)} USD / {percent(rawZig, 1)} ZiG
          </span>
        </div>
        <Bar usdPct={rawUsd} zigPct={rawZig} mounted={mounted} />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between font-mono text-[11px] text-ink-faint">
          <span className="flex items-center gap-1.5">
            PAYMENT SPLIT
            {capped && (
              <span className="bg-seal px-1.5 py-0.5 text-[10px] font-medium text-ink">CAPPED</span>
            )}
          </span>
          <span className="tabular-nums">
            {percent(paymentUsd, 1)} USD / {percent(paymentZig, 1)} ZiG
          </span>
        </div>
        <Bar usdPct={paymentUsd} zigPct={paymentZig} mounted={mounted} />
      </div>

      {capped && (
        <p className="text-xs text-ink-faint">
          Public Notice 71 pulled the raw {percent(rawUsd, 1)} / {percent(rawZig, 1)} split
          back to an even 50/50 because USD is the dominant trading currency.
        </p>
      )}
    </div>
  );
}