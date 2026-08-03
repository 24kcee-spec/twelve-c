"use client";

import { money } from "@/lib/format";

export interface RhythmSegment {
  label: string;
  date: string;
  percentage: number;
  amountUsd?: number;
  amountZig?: number;
}

const DEFAULT_SEGMENTS: RhythmSegment[] = [
  { label: "Q1", date: "25 Mar", percentage: 0.1 },
  { label: "Q2", date: "25 Jun", percentage: 0.25 },
  { label: "Q3", date: "25 Sep", percentage: 0.3 },
  { label: "Q4", date: "20 Dec", percentage: 0.35 },
];

const TINTS = ["bg-usd/25", "bg-usd/50", "bg-usd/75", "bg-usd"];
const TEXT_ON = ["text-ink", "text-ink", "text-surface", "text-surface"];

export function QuarterlyRhythm({
  segments = DEFAULT_SEGMENTS,
  currency = "USD",
  showAmounts = false,
  animate = true,
}: {
  segments?: RhythmSegment[];
  currency?: "USD" | "ZIG";
  showAmounts?: boolean;
  animate?: boolean;
}) {
  return (
    <div className="w-full">
      <div className="flex h-20 w-full overflow-hidden rounded-md border border-line">
        {segments.map((seg, i) => (
          <div
            key={seg.label}
            className={`${TINTS[i % TINTS.length]} flex flex-col justify-center border-r border-paper/40 px-3 py-2 last:border-r-0`}
            style={{
              flexGrow: seg.percentage,
              flexBasis: 0,
              transition: animate ? "flex-grow 700ms ease-out" : undefined,
            }}
          >
            <span className={`font-mono text-[11px] uppercase tracking-wide ${TEXT_ON[i % TEXT_ON.length]} opacity-80`}>
              {seg.label} · {seg.date}
            </span>
            <span className={`font-display text-lg leading-tight ${TEXT_ON[i % TEXT_ON.length]}`}>
              {(seg.percentage * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
      {showAmounts && (
        <div className="mt-2 flex w-full">
          {segments.map((seg, i) => (
            <div
              key={seg.label}
              className="px-3 text-sm text-ink-soft tabular-nums"
              style={{ flexGrow: seg.percentage, flexBasis: 0 }}
            >
              {currency === "USD"
                ? seg.amountUsd !== undefined
                  ? money(seg.amountUsd, "USD")
                  : "—"
                : seg.amountZig !== undefined
                ? money(seg.amountZig, "ZIG")
                : "—"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
