"use client";

import { useEffect, useRef, useState } from "react";
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

const DURATION_MS = 3600;
const REPLAY_KEY_STAGGER = 0;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
function seg(p: number, start: number, end: number): number {
  return clamp((p - start) / (end - start), 0, 1);
}
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * AnimatedScheduleReveal - the colorful, autoplay-on-mount version of
 * "the actual schedule" card on the landing page.
 *
 * Plays automatically as soon as it mounts (no scroll interaction
 * required): a thin USD/ZiG stream converges toward the 50/50 cap point,
 * then the four QPD segments grow in using the app's real currency
 * colors (usd green -> zig gold across the quarter arc, matching the
 * legend used everywhere else in the product), then per-segment amounts
 * fade in. A ghost "Replay" button appears once it settles so a visitor
 * can watch it again without reloading the page.
 *
 * Respects prefers-reduced-motion by rendering the final settled frame
 * immediately with no animation.
 */
export function AnimatedScheduleReveal() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const capDotRef = useRef<HTMLDivElement | null>(null);
  const capLabelRef = useRef<HTMLSpanElement | null>(null);
  const segmentRefs = useRef<HTMLDivElement[]>([]);
  const amountRefs = useRef<HTMLDivElement[]>([]);

  const [replayTick, setReplayTick] = useState(0);
  const [settled, setSettled] = useState(false);
  const rafRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);

  const addSegment = (el: HTMLDivElement | null) => {
    if (el && !segmentRefs.current.includes(el)) segmentRefs.current.push(el);
  };
  const addAmount = (el: HTMLDivElement | null) => {
    if (el && !amountRefs.current.includes(el)) amountRefs.current.push(el);
  };

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia(
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
        el.style.opacity = String(local > 0 ? 1 : 0);
      });

      amountRefs.current.forEach((el, i) => {
        const start = 0.72 + i * 0.05;
        el.style.opacity = String(seg(p, start, start + 0.15));
      });
    };

    if (reducedMotionRef.current) {
      render(1);
      setSettled(true);
      return;
    }

    const startTime = performance.now();
    setSettled(false);

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const p = clamp(elapsed / DURATION_MS, 0, 1);
      render(p);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setSettled(true);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [replayTick]);

  return (
    <div ref={containerRef} className="w-full">
      <div className="relative mb-3 h-6">
        <div
          ref={capDotRef}
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-ink"
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

      <div className="flex h-20 w-full overflow-hidden rounded-md border border-line">
        {QUARTERS.map((q, i) => (
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

      <div className="mt-3 flex h-5 items-center justify-end">
        {settled && (
          <button
            type="button"
            onClick={() => setReplayTick((t) => t + REPLAY_KEY_STAGGER + 1)}
            className="font-mono text-[11px] uppercase tracking-wide text-ink-faint transition hover:text-ink"
          >
            Replay
          </button>
        )}
      </div>
    </div>
  );
}