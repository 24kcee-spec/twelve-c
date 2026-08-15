"use client";

import { useEffect, useRef } from "react";
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
 * Layout: a small USD/ZiG convergence marker settles on the 50/50 cap
 * point, a slim proportional bar shows the real 10/25/30/35 split, and a
 * 2x2 grid of equal-width stat cards carries the quarter, date, percentage
 * and dual-currency amount — so the narrow Q1 slice never has to cram real
 * text into a 10%-wide box. The whole thing breathes in, holds, eases back
 * down, and repeats forever with no button and no user interaction.
 *
 * Respects prefers-reduced-motion by rendering the final settled frame
 * once, with no looping animation.
 */
export function AnimatedScheduleReveal() {
  const capLabelRef = useRef<HTMLSpanElement | null>(null);
  const usdDotRef = useRef<HTMLDivElement | null>(null);
  const zigDotRef = useRef<HTMLDivElement | null>(null);
  const capDotRef = useRef<HTMLDivElement | null>(null);
  const segmentRefs = useRef<HTMLDivElement[]>([]);
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

      segmentRefs.current.forEach((el, i) => {
        const start = 0.3 + i * 0.1;
        const local = easeOutCubic(seg(p, start, start + 0.22));
        const pct = QUARTERS[i].pct * 100;
        el.style.flexGrow = String(pct * local || 0.001);
        el.style.opacity = String(local);
      });

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
    <div className="aqs-root w-full">
      <div className="mb-4">
        <div className="mb-2 text-center">
          <span
            ref={capLabelRef}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint"
            style={{ opacity: 0 }}
          >
            50 / 50 cap · Public Notice 71
          </span>
        </div>
        <div className="relative h-3">
          <div className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-line" />
          <div
            ref={usdDotRef}
            className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-usd"
            style={{ left: "4%", opacity: 0 }}
          />
          <div
            ref={zigDotRef}
            className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-zig"
            style={{ left: "96%", opacity: 0 }}
          />
          <div
            ref={capDotRef}
            className="aqs-cap-dot absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink"
            style={{ opacity: 0 }}
          />
        </div>
      </div>

      <div className="aqs-bar relative flex h-3 w-full overflow-hidden rounded-full border border-line/70">
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

      <div className="mt-5 grid grid-cols-2 gap-3">
        {QUARTERS.map((q, i) => (
          <div
            key={q.label}
            ref={addCard}
            className="rounded-lg border border-line/70 bg-surface/60 px-3 py-2.5"
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