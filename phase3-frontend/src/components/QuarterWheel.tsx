"use client";

import { money } from "@/lib/format";

export type InstalmentStatus = "paid" | "overdue" | "active" | "upcoming";

export interface WheelSegment {
  label: string; // "Q1"
  date: string; // "25 Mar"
  percentage: number; // 0.10
  amountUsd: number;
  amountZig: number;
  status: InstalmentStatus;
}

const STROKE_USD: Record<InstalmentStatus, string> = {
  paid: "stroke-ink-faint/35",
  overdue: "stroke-danger",
  active: "stroke-usd",
  upcoming: "stroke-usd/35",
};

const STROKE_ZIG: Record<InstalmentStatus, string> = {
  paid: "stroke-ink-faint/35",
  overdue: "stroke-danger",
  active: "stroke-zig",
  upcoming: "stroke-zig/35",
};

const STATUS_TEXT: Record<InstalmentStatus, string> = {
  paid: "Paid",
  overdue: "Overdue",
  active: "Next",
  upcoming: "Upcoming",
};

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  // angleDeg = 0 is straight up (12 o'clock); increasing angle moves clockwise,
  // which keeps Q1 -> Q4 reading around the wheel the same way a clock face does.
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

/**
 * The product's signature visual: the four QPD instalments (10/25/30/35%)
 * drawn as proportional arcs around a ring, colour-coded by payment status,
 * with the selected currency's total tax due at the centre. This is meant to
 * be the one component someone remembers Twelve C by - reused wherever the
 * schedule appears (calculation page, PDF header, eventually dashboard cards).
 */
export function QuarterWheel({
  segments,
  currency,
  totalUsd,
  totalZig,
}: {
  segments: WheelSegment[];
  currency: "USD" | "ZIG";
  totalUsd: number;
  totalZig: number;
}) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const r = 82;
  const strokeWidth = 26;
  const gapDeg = 3; // visual separation between arcs

  let cursor = 0;
  const arcs = segments.map((seg) => {
    const sweep = seg.percentage * 360;
    const start = cursor + gapDeg / 2;
    const end = cursor + Math.max(sweep - gapDeg, 0);
    cursor += sweep;
    return { ...seg, start, end };
  });

  const strokeMap = currency === "USD" ? STROKE_USD : STROKE_ZIG;
  const activeChipClass = currency === "USD" ? "bg-usd-soft text-usd" : "bg-zig-soft text-zig";

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="QPD schedule wheel">
          {/* Faint full-ring track underneath, so gaps read as spacing, not gaps in data */}
          <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={strokeWidth} className="stroke-line" />
          {arcs.map((arc, i) => (
            <path
              key={arc.label}
              d={describeArc(cx, cy, r, arc.start, arc.end)}
              fill="none"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              className={`quarter-arc ${strokeMap[arc.status]} ${arc.status === "overdue" ? "quarter-arc-pulse" : ""}`}
              style={{ animationDelay: `${i * 90}ms` }}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint">Total due</span>
          <span className="font-display text-2xl leading-tight text-ink tabular-nums">
            {money(currency === "USD" ? totalUsd : totalZig, currency)}
          </span>
        </div>
      </div>

      <ul className="w-full space-y-1.5 sm:max-w-xs">
        {segments.map((seg) => (
          <li
            key={seg.label}
            className={`flex items-center justify-between rounded px-3 py-2 text-sm transition ${
              seg.status === "overdue"
                ? "bg-danger-soft text-danger"
                : seg.status === "active"
                ? activeChipClass
                : "text-ink-soft"
            }`}
          >
            <span className="flex items-center gap-2 truncate">
              <span className="font-mono text-xs font-semibold uppercase tracking-wide">{seg.label}</span>
              <span className="text-xs text-ink-faint">{seg.date}</span>
              {seg.status !== "upcoming" && (
                <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                  {STATUS_TEXT[seg.status]}
                </span>
              )}
            </span>
            <span className="shrink-0 font-mono tabular-nums">
              {money(currency === "USD" ? seg.amountUsd : seg.amountZig, currency)}
            </span>
          </li>
        ))}
      </ul>

      <style jsx>{`
        .quarter-arc {
          opacity: 0;
          transform-origin: ${cx}px ${cy}px;
          transform: scale(0.85);
          animation: quarter-draw-in 560ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes quarter-draw-in {
          from {
            opacity: 0;
            transform: scale(0.85);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .quarter-arc-pulse {
          animation:
            quarter-draw-in 560ms cubic-bezier(0.16, 1, 0.3, 1) forwards,
            quarter-pulse 2.2s ease-in-out 560ms infinite;
        }
        @keyframes quarter-pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.45;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .quarter-arc,
          .quarter-arc-pulse {
            animation: none;
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
