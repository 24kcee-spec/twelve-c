"use client";

import { useEffect, useState } from "react";
import { percent } from "@/lib/format";

function Bar({ usdPct, zigPct, mounted }: { usdPct: number; zigPct: number; mounted: boolean }) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line">
      <div
        className="h-full bg-brass"
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
    <div className="space-y-5">
      <div>
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <span className="text-ink-soft">Raw trade split</span>
          <span className="tabular-nums text-ink-faint">
            {percent(rawUsd, 1)} USD &middot; {percent(rawZig, 1)} ZiG
          </span>
        </div>
        <Bar usdPct={rawUsd} zigPct={rawZig} mounted={mounted} />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 text-ink-soft">
            <span className="font-semibold text-ink">Payment split</span>
            {capped && (
              <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[10.5px] font-semibold text-danger">
                Capped
              </span>
            )}
          </span>
          <span className="tabular-nums text-ink-faint">
            {percent(paymentUsd, 1)} USD &middot; {percent(paymentZig, 1)} ZiG
          </span>
        </div>
        <Bar usdPct={paymentUsd} zigPct={paymentZig} mounted={mounted} />
      </div>

      {capped && (
        <p className="border-l-2 border-ink/15 pl-3 text-xs italic text-ink-faint">
          Public Notice 71 pulled the raw {percent(rawUsd, 1)} / {percent(rawZig, 1)} split back to an even
          50/50 because USD is the dominant trading currency.
        </p>
      )}
    </div>
  );
}