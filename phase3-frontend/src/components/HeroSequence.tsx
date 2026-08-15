"use client";

import { useEffect, useRef } from "react";

interface QpdStamp {
  pct: string;
  date: string;
  x: number;
}

const QPD_STAMPS: QpdStamp[] = [
  { pct: "10%", date: "25 MAR", x: 190 },
  { pct: "25%", date: "25 JUN", x: 400 },
  { pct: "30%", date: "25 SEP", x: 610 },
  { pct: "35%", date: "20 DEC", x: 820 },
];

const USD_ROWS = ["4,120.00", "3,860.50", "5,940.10", "2,200.00"];
const ZIG_ROWS = ["ZiG 118,400", "ZiG 95,220", "ZiG 210,900", "ZiG 61,750"];

const PATH_LENGTH = 2400;
const SEEN_KEY = "twelvec_hero_seen";
const SCROLL_VH = 320;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function seg(p: number, start: number, end: number): number {
  return clamp((p - start) / (end - start), 0, 1);
}

/**
 * HeroSequence — the scroll-scrubbed "ledger opens" intro.
 *
 * Ink draws the ledger frame, USD/ZIG income streams flow in from
 * opposite edges, the 50/50 Public Notice 71 cap line wobbles and locks
 * into place, the four QPD due dates stamp in on schedule, then
 * everything condenses into the Twelve C wordmark - all driven directly
 * by scroll position (not a timer), so it reads as an instrument
 * responding to the user's hand rather than a video playing at them.
 *
 * Uses the app's real design tokens (text-usd for the USD stream,
 * text-zig for the ZIG stream, text-ink for structure) via currentColor,
 * so it repaints automatically with the existing light/dark theme -
 * nothing hardcoded here fights ThemeProvider.
 *
 * Shows a single static final frame - no scroll listener, no motion -
 * when the visitor has prefers-reduced-motion set, or once per browser
 * session after the first full view, so returning users are never
 * forced to sit through it again.
 */
export default function HeroSequence() {
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const ledgerPathRef = useRef<SVGPathElement | null>(null);
  const rulesRef = useRef<SVGLineElement[]>([]);
  const usdLabelRef = useRef<SVGTextElement | null>(null);
  const zigLabelRef = useRef<SVGTextElement | null>(null);
  const usdStreamRef = useRef<SVGTextElement[]>([]);
  const zigStreamRef = useRef<SVGTextElement[]>([]);
  const capLineRef = useRef<SVGLineElement | null>(null);
  const capTickTopRef = useRef<SVGTextElement | null>(null);
  const capTickLabelRef = useRef<SVGTextElement | null>(null);
  const stampsRef = useRef<SVGGElement[]>([]);
  const wordmarkRef = useRef<SVGTextElement | null>(null);
  const wordmarkSubRef = useRef<SVGTextElement | null>(null);

  const rafRef = useRef<number | null>(null);
  const staticFrameRef = useRef<boolean>(false);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let alreadySeen = false;
    try {
      alreadySeen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      alreadySeen = false;
    }

    const render = (p: number) => {
      const s1 = seg(p, 0.0, 0.16);
      if (ledgerPathRef.current) {
        ledgerPathRef.current.style.strokeDashoffset = String(
          PATH_LENGTH * (1 - s1)
        );
      }

      const s1b = seg(p, 0.12, 0.2);
      rulesRef.current.forEach((el, i) => {
        const local = clamp((s1b - i * 0.03) / 0.4, 0, 1);
        el.style.opacity = String(local * 0.6);
      });

      const s2 = seg(p, 0.18, 0.4);
      if (usdLabelRef.current) {
        usdLabelRef.current.style.opacity = String(seg(p, 0.16, 0.24));
      }
      if (zigLabelRef.current) {
        zigLabelRef.current.style.opacity = String(seg(p, 0.16, 0.24));
      }
      usdStreamRef.current.forEach((el, i) => {
        const local = clamp((s2 - i * 0.08) / 0.6, 0, 1);
        el.style.opacity = String(local);
        el.setAttribute("transform", `translate(${lerp(-40, 0, local)},0)`);
      });
      zigStreamRef.current.forEach((el, i) => {
        const local = clamp((s2 - i * 0.08) / 0.6, 0, 1);
        el.style.opacity = String(local);
        el.setAttribute("transform", `translate(${lerp(40, 0, local)},0)`);
      });

      const s3 = seg(p, 0.42, 0.52);
      const wobble = lerp(620, 550, s3);
      if (capLineRef.current) {
        capLineRef.current.style.opacity = String(s3);
        capLineRef.current.setAttribute("x1", String(wobble));
        capLineRef.current.setAttribute("x2", String(wobble));
      }
      if (capTickTopRef.current) {
        capTickTopRef.current.style.opacity = String(s3);
        capTickTopRef.current.setAttribute("x", String(wobble));
      }
      const s3b = seg(p, 0.5, 0.58);
      if (capTickLabelRef.current) {
        capTickLabelRef.current.style.opacity = String(s3b);
      }

      stampsRef.current.forEach((el, i) => {
        const start = 0.58 + i * 0.055;
        const local = seg(p, start, start + 0.09);
        el.style.opacity = String(local);
        const scale = lerp(1.4, 0.95, local);
        const base = el.getAttribute("data-base-transform") ?? "";
        el.setAttribute("transform", `${base}scale(${scale})`);
      });

      const s5 = seg(p, 0.86, 1.0);
      if (wordmarkRef.current) {
        wordmarkRef.current.style.opacity = String(s5);
        wordmarkRef.current.setAttribute(
          "transform",
          `translate(0,${lerp(20, 0, s5)})`
        );
      }
      if (wordmarkSubRef.current) {
        wordmarkSubRef.current.style.opacity = String(seg(p, 0.92, 1.0));
      }

      const fadeOut = 1 - seg(p, 0.86, 0.98);
      [
        ledgerPathRef.current,
        usdLabelRef.current,
        zigLabelRef.current,
        capLineRef.current,
        capTickTopRef.current,
        capTickLabelRef.current,
      ].forEach((el) => {
        if (el) el.style.opacity = String(fadeOut);
      });
      usdStreamRef.current.forEach((el) => {
        el.style.opacity = String(Number(el.style.opacity || "0") * fadeOut);
      });
      zigStreamRef.current.forEach((el) => {
        el.style.opacity = String(Number(el.style.opacity || "0") * fadeOut);
      });
      stampsRef.current.forEach((el) => {
        el.style.opacity = String(Number(el.style.opacity || "0") * fadeOut);
      });
      rulesRef.current.forEach((el) => {
        el.style.opacity = String(0.6 * fadeOut);
      });
    };

    if (prefersReducedMotion || alreadySeen) {
      staticFrameRef.current = true;
      render(1);
      return;
    }

    const onScroll = () => {
      const wrap = stageWrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const p = clamp(-rect.top / Math.max(total, 1), 0, 1);

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        render(p);
        if (p >= 0.98) {
          try {
            sessionStorage.setItem(SEEN_KEY, "1");
          } catch {
            /* sessionStorage unavailable - non-fatal, sequence just replays */
          }
        }
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const addRule = (el: SVGLineElement | null) => {
    if (el && !rulesRef.current.includes(el)) rulesRef.current.push(el);
  };
  const addUsdRow = (el: SVGTextElement | null) => {
    if (el && !usdStreamRef.current.includes(el)) usdStreamRef.current.push(el);
  };
  const addZigRow = (el: SVGTextElement | null) => {
    if (el && !zigStreamRef.current.includes(el)) zigStreamRef.current.push(el);
  };
  const addStamp = (el: SVGGElement | null) => {
    if (el && !stampsRef.current.includes(el)) stampsRef.current.push(el);
  };

  return (
    <div
      ref={stageWrapRef}
      className="relative bg-paper"
      style={{ height: staticFrameRef.current ? "100vh" : `${SCROLL_VH}vh` }}
    >
      <div className="sticky top-0 flex h-screen w-full items-center justify-center overflow-hidden bg-paper">
        <svg
          viewBox="0 0 1100 620"
          className="w-full max-w-[1100px] px-6"
          role="img"
          aria-label="Twelve C: an animated ledger showing USD and ZiG income streams capping at the 50/50 trading-currency ratio under Public Notice 71, then the four QPD due dates stamping in, resolving to the Twelve C wordmark."
        >
          <g className="text-line">
            {[180, 260, 340, 420].map((y) => (
              <line
                key={y}
                ref={addRule}
                x1={120}
                y1={y}
                x2={980}
                y2={y}
                stroke="currentColor"
                strokeWidth={1}
                style={{ opacity: 0 }}
              />
            ))}
          </g>

          <path
            ref={ledgerPathRef}
            d="M120,140 L980,140 L980,480 L120,480 Z"
            fill="none"
            className="text-ink"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            style={{
              strokeDasharray: PATH_LENGTH,
              strokeDashoffset: PATH_LENGTH,
            }}
          />

          <text
            ref={usdLabelRef}
            x={150}
            y={150}
            fontSize={11}
            letterSpacing="0.14em"
            className="fill-ink-faint font-body"
            style={{ opacity: 0 }}
          >
            USD INCOME
          </text>
          <text
            ref={zigLabelRef}
            x={820}
            y={150}
            textAnchor="end"
            fontSize={11}
            letterSpacing="0.14em"
            className="fill-ink-faint font-body"
            style={{ opacity: 0 }}
          >
            ZIG INCOME
          </text>

          <g className="fill-usd">
            {USD_ROWS.map((v, i) => (
              <text
                key={v}
                ref={addUsdRow}
                x={150}
                y={190 + i * 40}
                className="font-mono"
                fontSize={13}
                style={{ opacity: 0 }}
              >
                {v}
              </text>
            ))}
          </g>
          <g className="fill-zig">
            {ZIG_ROWS.map((v, i) => (
              <text
                key={v}
                ref={addZigRow}
                x={820}
                y={190 + i * 40}
                textAnchor="end"
                className="font-mono"
                fontSize={13}
                style={{ opacity: 0 }}
              >
                {v}
              </text>
            ))}
          </g>

          <g className="text-ink">
            <line
              ref={capLineRef}
              x1={550}
              y1={170}
              x2={550}
              y2={490}
              stroke="currentColor"
              strokeWidth={2}
              style={{ opacity: 0 }}
            />
            <text
              ref={capTickTopRef}
              x={550}
              y={160}
              textAnchor="middle"
              className="font-mono"
              fontSize={12}
              fill="currentColor"
              style={{ opacity: 0 }}
            >
              CAP
            </text>
            <text
              ref={capTickLabelRef}
              x={550}
              y={505}
              textAnchor="middle"
              className="font-mono"
              fontSize={12}
              fill="currentColor"
              style={{ opacity: 0 }}
            >
              50 / 50 · PUBLIC NOTICE 71
            </text>
          </g>

          <g className="text-ink">
            {QPD_STAMPS.map((q) => (
              <g
                key={q.pct}
                ref={addStamp}
                data-base-transform={`translate(${q.x},300) `}
                transform={`translate(${q.x},300) scale(1.4)`}
                style={{ opacity: 0 }}
              >
                <rect
                  x={-55}
                  y={-30}
                  width={110}
                  height={60}
                  rx={2}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.4}
                />
                <text
                  x={0}
                  y={2}
                  textAnchor="middle"
                  className="font-display"
                  fontSize={20}
                  fontWeight={600}
                  fill="currentColor"
                >
                  {q.pct}
                </text>
                <text
                  x={0}
                  y={20}
                  textAnchor="middle"
                  className="font-mono fill-ink-faint"
                  fontSize={10}
                  letterSpacing="0.04em"
                >
                  {q.date}
                </text>
              </g>
            ))}
          </g>

          <text
            ref={wordmarkRef}
            x={550}
            y={560}
            textAnchor="middle"
            className="font-display"
            fontSize={42}
            letterSpacing="0.02em"
            fill="currentColor"
            style={{ opacity: 0 }}
          >
            <tspan className="fill-ink">Twelve</tspan>{" "}
            <tspan className="fill-usd">C</tspan>
          </text>
          <text
            ref={wordmarkSubRef}
            x={550}
            y={588}
            textAnchor="middle"
            className="font-body fill-ink-faint"
            fontSize={12}
            letterSpacing="0.22em"
            style={{ opacity: 0 }}
          >
            PROVISIONAL TAX, DONE PROPERLY
          </text>
        </svg>
      </div>
    </div>
  );
}