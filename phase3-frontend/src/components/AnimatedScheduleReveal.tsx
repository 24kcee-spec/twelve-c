"use client";

import { useEffect, useRef } from "react";
import { money } from "@/lib/format";

interface Quarter {
  label: string;
  date: string;
  pct: number;
  fill: string;
  text: string;
}

const QUARTERS: Quarter[] = [
  { label: "Q1", date: "25 Mar", pct: 0.1, fill: "bg-usd", text: "text-surface" },
  { label: "Q2", date: "25 Jun", pct: 0.25, fill: "bg-usd/60", text: "text-ink" },
  { label: "Q3", date: "25 Sep", pct: 0.3, fill: "bg-zig/70", text: "text-ink" },
  { label: "Q4", date: "20 Dec", pct: 0.35, fill: "bg-zig", text: "text-surface" },
];

const USD_VALUES = [980, 2450, 2940, 3430];
const ZIG_VALUES = [29600, 74000, 88800, 103600];

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
 * Runs a continuous breathing cycle with no user interaction and no replay
 * control: a USD/ZiG stream converges on the 50/50 cap point, the four QPD
 * segments grow in with the app's real currency colors, the per-segment
 * amounts lift into view, everything holds for a beat with a soft
 * "live preview" pulse and a light sheen sweep, then eases back down and
 * starts again — forever, on its own.
 *
 * Respects prefers-reduced-motion by rendering the final settled frame
 * once, with no looping animation.
 */
export function AnimatedScheduleReveal() {
  const capDotRef = useRef<HTMLDivElement | null>(null);
  const capLabelRef = useRef<HTMLSpanElement | null>(null);
  const segmentRefs = useRef<HTMLDivElement[]>([]);
  const amountRefs = useRef<HTMLDivElement[]>([]);
  const liveDotRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const wasFullRef = useRef(false);

  const addSegment = (el: HTMLDivElement | null) => {
    if (el && !segmentRefs.current.includes(el)) segmentRefs.current.push(el);
  };
  const addAmount = (el: HTMLDivElement | null) => {
    if (el && !amountRefs.current.includes(el)) amountRefs.current.push(el);
  };

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const render = (p: number) => {
      const sCap = seg(p, 0.0, 0.28);
      const eased = easeOutCubic(sCap);
      if (capDotRef.current) {
        capDotRef.current.style.left = `${50 - (1 - eased) * 22}%`;
        capDotRef.current.style.opacity = String(sCap);
      }
      if (capLabelRef.current) {
        capLabelRef.current.style.opacity = String(seg(p, 0.2, 0.32));
      }

      segmentRefs.current.forEach((el, i) => {
        const start = 0.3 + i * 0.1;
        const local = easeOutCubic(seg(p, start, start + 0.22));
        const pct = QUARTERS[i].pct * 100;
        el.style.flexGrow = String(pct * local || 0.001);
        el.style.opacity = String(local);
        el.style.transform = `scaleY(${0.94 + 0.06 * local})`;
      });

      amountRefs.current.forEach((el, i) => {
        const start = 0.72 + i * 0.05;
        const local = seg(p, start, start + 0.18);
        el.style.opacity = String(local);
        el.style.transform = `translateY(${(1 - local) * 4}px)`;
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
        liveDotRef.current?.classList.toggle("aqs-live-on", isFull);
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="aqs-root w-full">
      <div className="relative mb-3 h-6">
        <div
          ref={capDotRef}
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-ink shadow-[0_0_0_4px_rgba(22,36,28,0.08)]"
          style={{ left: "28%", opacity: 0 }}
        />
        <span
          ref={capLabelRef}
          className="absolute left-1/2 top-0 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint"
          style={{ opacity: 0 }}
        >
          50 / 50 cap · Public Notice 71
        </span>
      </div>

      <div className="aqs-bar relative flex h-20 w-full overflow-hidden rounded-lg border border-line shadow-card">
        <div className="aqs-sheen pointer-events-none absolute inset-0" />
        {QUARTERS.map((q) => (
          <div
            key={q.label}
            ref={addSegment}
            className={`${q.fill} flex flex-col justify-center border-r border-paper/40 px-3 py-2 last:border-r-0`}
            style={{ flexGrow: 0.001, flexBasis: 0, opacity: 0 }}
          >
            <span className={`font-mono text-[11px] uppercase tracking-wide ${q.text} opacity-90`}>
              {q.label} · {q.date}
            </span>
            <span className={`font-display text-lg leading-tight ${q.text}`}>
              {(q.pct * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      <div className="mt-2 flex w-full">
        {QUARTERS.map((q, i) => (
          <div
            key={q.label}
            ref={addAmount}
            className="px-3 text-sm text-ink-soft tabular-nums"
            style={{ flexGrow: q.pct, flexBasis: 0, opacity: 0 }}
          >
            {money(USD_VALUES[i], "USD")}
            <span className="text-ink-faint"> / </span>
            {money(ZIG_VALUES[i], "ZIG")}
          </div>
        ))}
      </div>

      <div className="mt-3 flex h-5 items-center justify-end gap-2">
        <span ref={liveDotRef} className="aqs-live-dot" />
        <span className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">
          Live preview
        </span>
      </div>

      <style jsx>{`
        .aqs-sheen {
          background: linear-gradient(
            110deg,
            transparent 20%,
            rgba(255, 255, 255, 0.16) 40%,
            rgba(255, 255, 255, 0.28) 50%,
            rgba(255, 255, 255, 0.16) 60%,
            transparent 80%
          );
          background-size: 220% 100%;
          animation: aqs-shimmer 5.2s ease-in-out infinite;
          mix-blend-mode: overlay;
        }
        .aqs-live-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: rgb(var(--color-ink-faint));
          transition: background-color 0.3s ease;
        }
        .aqs-live-dot.aqs-live-on {
          background: rgb(var(--color-usd));
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
            box-shadow: 0 0 0 0 rgb(var(--color-usd) / 0.35);
          }
          50% {
            box-shadow: 0 0 0 5px rgb(var(--color-usd) / 0);
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