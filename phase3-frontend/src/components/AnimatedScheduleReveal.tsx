"use client";

import { useEffect, useId, useRef } from "react";
import { money } from "@/lib/format";

interface Quarter {
  label: string;
  date: string;
  pct: number;
  fill: string;
}

const QUARTERS: Quarter[] = [
  { label: "Q1", date: "25 Mar", pct: 0.1, fill: "bg-usd" },
  { label: "Q2", date: "25 Jun", pct: 0.25, fill: "bg-usd/60" },
  { label: "Q3", date: "25 Sep", pct: 0.3, fill: "bg-zig/70" },
  { label: "Q4", date: "20 Dec", pct: 0.35, fill: "bg-zig" },
];

const USD_VALUES = [980, 2450, 2940, 3430];
const ZIG_VALUES = [29600, 74000, 88800, 103600];

// Cumulative % of the year's tax owed after each quarter: 10, 35, 65, 100.
const CUM_PCT = [0, 10, 35, 65, 100];
const LINE_POINTS = CUM_PCT.map((pct, i) => {
  const x = i * 25;
  const y = 24 - (pct / 100) * 24;
  return `${x},${y.toFixed(2)}`;
}).join(" ");
const LINE_PATH_LENGTH = 110; // safely longer than the actual drawn path

// One full breathing cycle: grow in -> hold (live) -> ease back down -> brief rest -> repeat.
const GROW_MS = 2600;
const HOLD_FULL_MS = 2400;
const SHRINK_MS = 1500;
const HOLD_EMPTY_MS = 500;
const CYCLE_MS = GROW_MS + HOLD_FULL_MS + SHRINK_MS + HOLD_EMPTY_MS;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
function seg(p: number, start: number, end: number): number {
  return clamp((p - start) / (end - start), 0, 1);
}
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * AnimatedScheduleReveal — a self-playing, infinitely looping visualization
 * of "the actual schedule" card on the landing page.
 *
 * Layout, top to bottom:
 *  - a running total (USD + ZiG) that counts up in sync with the bar,
 *    paired with a small USD/ZiG convergence marker settling on the 50/50
 *    cap point
 *  - a cumulative sparkline that draws in above the bar, visibly steeper
 *    across Q3-Q4 - proving the "back-loaded" claim before anyone reads a
 *    number
 *  - a slim proportional bar showing the real 10/25/30/35 split
 *  - a caliper-style bracket spanning Q3+Q4 labelled "65% of the year's
 *    tax lands here"
 *  - a 2x2 grid of equal-width stat cards (quarter, date, %, amount) so
 *    the narrow Q1 slice never has to cram real text into a 10%-wide box
 *
 * A contained, low-opacity usd/zig radial glow sits behind everything for
 * depth, fully within this component's own box - no bleed past the card.
 *
 * The whole thing breathes in, holds, eases back down, and repeats
 * forever with no button and no user interaction. Respects
 * prefers-reduced-motion by rendering the final settled frame once, with
 * no looping animation.
 */
export function AnimatedScheduleReveal() {
  const gradientId = useId();

  const totalUsdRef = useRef<HTMLSpanElement | null>(null);
  const totalZigRef = useRef<HTMLSpanElement | null>(null);
  const capLabelRef = useRef<HTMLSpanElement | null>(null);
  const usdDotRef = useRef<HTMLDivElement | null>(null);
  const zigDotRef = useRef<HTMLDivElement | null>(null);
  const capDotRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<SVGPolylineElement | null>(null);
  const lineDotRef = useRef<SVGCircleElement | null>(null);
  const segmentRefs = useRef<HTMLDivElement[]>([]);
  const bracketRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<HTMLDivElement[]>([]);
  const rafRef = useRef<number | null>(null);
  const wasFullRef = useRef(false);

  const addSegment = (el: HTMLDivElement | null) => {
    if (el && !segmentRefs.current.includes(el)) segmentRefs.current.push(el);
  };
  const addCard = (el: HTMLDivElement | null) => {
    if (el && !cardRefs.current.includes(el)) cardRefs.current.push(el);
  };

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const render = (p: number) => {
      // USD/ZiG convergence marker
      const sConverge = seg(p, 0, 0.26);
      const easedConverge = easeOutCubic(sConverge);
      if (usdDotRef.current) {
        usdDotRef.current.style.left = `${4 + easedConverge * 44}%`;
        usdDotRef.current.style.opacity = String(sConverge);
      }
      if (zigDotRef.current) {
        zigDotRef.current.style.left = `${96 - easedConverge * 44}%`;
        zigDotRef.current.style.opacity = String(sConverge);
      }
      if (capDotRef.current) {
        capDotRef.current.style.opacity = String(seg(p, 0.22, 0.32));
      }
      if (capLabelRef.current) {
        capLabelRef.current.style.opacity = String(seg(p, 0.16, 0.3));
      }

      // Quarter bar segments + running total (driven by the same per-quarter
      // reveal progress, so the counter climbs exactly as each block fills)
      let usdTotal = 0;
      let zigTotal = 0;
      segmentRefs.current.forEach((el, i) => {
        const start = 0.3 + i * 0.1;
        const local = easeOutCubic(seg(p, start, start + 0.22));
        const pct = QUARTERS[i].pct * 100;
        el.style.flexGrow = String(pct * local || 0.001);
        el.style.opacity = String(local);
        usdTotal += USD_VALUES[i] * local;
        zigTotal += ZIG_VALUES[i] * local;
      });
      if (totalUsdRef.current) {
        totalUsdRef.current.textContent = money(usdTotal, "USD");
      }
      if (totalZigRef.current) {
        totalZigRef.current.textContent = money(zigTotal, "ZIG");
      }

      // Cumulative sparkline draw-in
      const lineReveal = easeOutCubic(seg(p, 0.05, 0.85));
      if (lineRef.current) {
        lineRef.current.style.strokeDasharray = String(LINE_PATH_LENGTH);
        lineRef.current.style.strokeDashoffset = String(
          LINE_PATH_LENGTH * (1 - lineReveal)
        );
      }
      if (lineDotRef.current) {
        lineDotRef.current.style.opacity = String(seg(p, 0.78, 0.9));
      }

      // 65% bracket annotation
      if (bracketRef.current) {
        bracketRef.current.style.opacity = String(seg(p, 0.58, 0.74));
      }

      // Stat card grid
      cardRefs.current.forEach((el, i) => {
        const start = 0.66 + i * 0.06;
        const local = seg(p, start, start + 0.2);
        el.style.opacity = String(local);
        el.style.transform = `translateY(${(1 - local) * 6}px)`;
      });
    };

    if (reducedMotion) {
      render(1);
      return;
    }

    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = (now - startTime) % CYCLE_MS;
      let p: number;
      let isFull = false;

      if (elapsed < GROW_MS) {
        p = elapsed / GROW_MS;
      } else if (elapsed < GROW_MS + HOLD_FULL_MS) {
        p = 1;
        isFull = true;
      } else if (elapsed < GROW_MS + HOLD_FULL_MS + SHRINK_MS) {
        const t = (elapsed - GROW_MS - HOLD_FULL_MS) / SHRINK_MS;
        p = 1 - easeInOutCubic(t);
      } else {
        p = 0;
      }

      render(p);

      if (isFull !== wasFullRef.current) {
        wasFullRef.current = isFull;
        capDotRef.current?.classList.toggle("aqs-live-on", isFull);
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="aqs-root relative w-full">
      <div className="aqs-glow pointer-events-none absolute inset-0 -z-10" />

      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">
            Total this year
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span
              ref={totalUsdRef}
              className="font-display text-2xl leading-none text-ink tabular-nums"
            >
              $0.00
            </span>
            <span
              ref={totalZigRef}
              className="text-[11px] text-ink-faint tabular-nums"
            >
              ZiG 0.00
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end pt-0.5">
          <span
            ref={capLabelRef}
            className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint"
            style={{ opacity: 0 }}
          >
            50 / 50 cap · Public Notice 71
          </span>
          <div className="relative mt-1.5 h-2 w-20">
            <div className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-line" />
            <div
              ref={usdDotRef}
              className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-usd"
              style={{ left: "4%", opacity: 0 }}
            />
            <div
              ref={zigDotRef}
              className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-zig"
              style={{ left: "96%", opacity: 0 }}
            />
            <div
              ref={capDotRef}
              className="aqs-cap-dot absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink"
              style={{ opacity: 0 }}
            />
          </div>
        </div>
      </div>

      <svg
        className="block h-6 w-full"
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(var(--color-usd))" />
            <stop offset="100%" stopColor="rgb(var(--color-zig))" />
          </linearGradient>
        </defs>
        <polyline
          ref={lineRef}
          points={LINE_POINTS}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{
            strokeDasharray: LINE_PATH_LENGTH,
            strokeDashoffset: LINE_PATH_LENGTH,
          }}
        />
        <circle
          ref={lineDotRef}
          cx="100"
          cy="0"
          r="2.2"
          fill="rgb(var(--color-zig))"
          style={{ opacity: 0 }}
        />
      </svg>

      <div className="aqs-bar relative mt-1 flex h-3 w-full overflow-hidden rounded-full border border-line/70 shadow-[0_2px_8px_-2px_rgba(22,36,28,0.15)]">
        <div className="aqs-sheen pointer-events-none absolute inset-0 z-10" />
        {QUARTERS.map((q) => (
          <div
            key={q.label}
            ref={addSegment}
            className={`${q.fill} h-full`}
            style={{ flexGrow: 0.001, flexBasis: 0, opacity: 0 }}
          />
        ))}
      </div>

      <div ref={bracketRef} className="mt-3 flex w-full" style={{ opacity: 0 }}>
        <div style={{ flexGrow: 0.35, flexBasis: 0 }} />
        <div
          style={{ flexGrow: 0.65, flexBasis: 0 }}
          className="flex flex-col items-center"
        >
          <div className="relative h-2 w-full">
            <span className="absolute left-0 top-0 h-2 w-px bg-ink-faint/60" />
            <span className="absolute right-0 top-0 h-2 w-px bg-ink-faint/60" />
            <span className="absolute inset-x-0 top-0 h-px bg-ink-faint/60" />
          </div>
          <span className="mt-1.5 text-center font-mono text-[10px] uppercase tracking-wide text-ink-faint">
            65% of the year&apos;s tax lands here
          </span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {QUARTERS.map((q, i) => (
          <div
            key={q.label}
            ref={addCard}
            className="rounded-lg border border-line/70 bg-surface/70 px-3 py-2.5 shadow-sm"
            style={{ opacity: 0 }}
          >
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${q.fill}`} />
              <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                {q.label} · {q.date}
              </span>
            </div>
            <div className="mt-1 font-display text-xl leading-tight text-ink">
              {(q.pct * 100).toFixed(0)}%
            </div>
            <div className="mt-1 text-[12px] leading-snug text-ink-soft tabular-nums">
              {money(USD_VALUES[i], "USD")}
              <span className="text-ink-faint"> / </span>
              {money(ZIG_VALUES[i], "ZIG")}
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        .aqs-glow {
          background: radial-gradient(
              circle at 15% 20%,
              rgb(var(--color-usd) / 0.14),
              transparent 55%
            ),
            radial-gradient(
              circle at 88% 75%,
              rgb(var(--color-zig) / 0.16),
              transparent 55%
            );
          filter: blur(28px);
        }
        .aqs-sheen {
          background: linear-gradient(
            110deg,
            transparent 20%,
            rgba(255, 255, 255, 0.35) 40%,
            rgba(255, 255, 255, 0.55) 50%,
            rgba(255, 255, 255, 0.35) 60%,
            transparent 80%
          );
          background-size: 220% 100%;
          animation: aqs-shimmer 5.2s ease-in-out infinite;
          mix-blend-mode: overlay;
        }
        .aqs-cap-dot.aqs-live-on {
          animation: aqs-pulse 1.8s ease-in-out infinite;
        }
        @keyframes aqs-shimmer {
          0% {
            background-position: 140% 0;
          }
          100% {
            background-position: -60% 0;
          }
        }
        @keyframes aqs-pulse {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgb(var(--color-ink) / 0.3);
          }
          50% {
            box-shadow: 0 0 0 6px rgb(var(--color-ink) / 0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .aqs-sheen {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}