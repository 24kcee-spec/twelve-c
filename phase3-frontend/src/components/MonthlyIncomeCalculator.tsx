"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { MONTHS_ELAPSED_BY_QUARTER, RollingInputs, computeAnnual, roundToCents } from "@/lib/rollingEstimate";
import { MonthlyIncomeEntry } from "@/lib/types";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type LoadState = "loading" | "ready" | "error";
type CurrencyRow = RollingInputs;

/** Lets the page force any pending autosave out the door before it submits
 *  (or navigates away), instead of racing the 900ms debounce. Resolves true
 *  if everything is saved, false if a save failed. */
export interface MonthlyIncomeHandle {
  flush: () => Promise<boolean>;
}

interface PendingSave {
  businessId: string;
  taxYear: number;
  entries: MonthlyIncomeEntry[];
}

function emptyRow(monthsElapsed: number): CurrencyRow {
  return { months: Array(monthsElapsed).fill(0), oneOff: 0, bufferPct: 0 };
}

function resizeMonths(months: number[], targetLength: number, canonical: number[]): number[] {
  if (months.length === targetLength) return months;
  if (months.length > targetLength) return months.slice(0, targetLength);
  // Growing the window (e.g. QPD1 -> QPD2): restore each newly-revealed slot
  // from the full 12-month record instead of zero-filling it.
  const extra = canonical.slice(months.length, targetLength);
  return [...months, ...extra];
}

function CurrencyColumn({
  currency,
  monthsElapsed,
  row,
  setRow,
  wasEstimate,
  touched,
  onTouch,
}: {
  currency: "USD" | "ZIG";
  monthsElapsed: number;
  row: CurrencyRow;
  setRow: (row: CurrencyRow) => void;
  wasEstimate: boolean[];
  touched: Set<number>;
  onTouch: (index: number) => void;
}) {
  const result = computeAnnual(row, monthsElapsed);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {row.months.map((val, i) => {
          const isEstimate = i === row.months.length - 1;
          // A month that was saved as an ESTIMATE at an earlier QPD but is
          // now a closed month: nudge the person to replace it with the
          // actual figure.
          const confirmActual = !isEstimate && wasEstimate[i] && !touched.has(i);
          return (
            <label key={i} className="block">
              <span className="mb-1 flex items-center justify-between text-xs text-ink-faint">
                <span>{MONTH_NAMES[i]}</span>
                <span className={isEstimate ? "text-seal" : confirmActual ? "text-danger" : ""}>
                  {isEstimate ? "Estimate" : confirmActual ? "Was estimate - confirm" : "Actual"}
                </span>
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={val === 0 ? "" : val}
                placeholder="0.00"
                onChange={(e) => {
                  onTouch(i);
                  const next = [...row.months];
                  next[i] = parseFloat(e.target.value) || 0;
                  setRow({ ...row, months: next });
                }}
                className="w-full rounded border border-line bg-surface px-2.5 py-1.5 font-mono text-sm text-ink outline-none transition focus:border-seal"
              />
            </label>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
        <label className="block">
          <span className="mb-1 block text-xs text-ink-faint">One-off adjustment</span>
          <input
            type="number"
            step="0.01"
            value={row.oneOff === 0 ? "" : row.oneOff}
            placeholder="0.00"
            onChange={(e) => setRow({ ...row, oneOff: parseFloat(e.target.value) || 0 })}
            className="w-full rounded border border-line bg-surface px-2.5 py-1.5 font-mono text-sm text-ink outline-none transition focus:border-seal"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-faint">Buffer %</span>
          <input
            type="number"
            step="0.5"
            min={0}
            value={row.bufferPct === 0 ? "" : row.bufferPct}
            placeholder="0"
            onChange={(e) => setRow({ ...row, bufferPct: parseFloat(e.target.value) || 0 })}
            className="w-full rounded border border-line bg-surface px-2.5 py-1.5 font-mono text-sm text-ink outline-none transition focus:border-seal"
          />
        </label>
      </div>

      <div className="rounded-md bg-usd-soft px-3 py-2 text-sm">
        <div className="flex items-center justify-between text-ink-faint">
          <span>{monthsElapsed}-month total</span>
          <span className="font-mono">{money(result.sum, currency)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between font-semibold text-usd">
          <span>Annual estimate</span>
          <span className="font-mono">{money(result.buffered, currency)}</span>
        </div>
      </div>
    </div>
  );
}

export const MonthlyIncomeCalculator = forwardRef<
  MonthlyIncomeHandle,
  {
    businessId: string;
    taxYear: number;
    quarter: number;
    onUsdChange: (v: number) => void;
    onZigChange: (v: number) => void;
    /** True while the calculator can't yet give a trustworthy figure (saved
     *  months still loading, or failed to load). The page uses this to hold
     *  the submit button so a blank grid can never be calculated as R0. */
    onBlockedChange?: (blocked: boolean) => void;
  }
>(function MonthlyIncomeCalculator(
  { businessId, taxYear, quarter, onUsdChange, onZigChange, onBlockedChange },
  ref
) {
  const monthsElapsed = MONTHS_ELAPSED_BY_QUARTER[quarter] ?? 3;
  const [manual, setManual] = useState(false);
  const [usdRow, setUsdRow] = useState<CurrencyRow>(() => emptyRow(monthsElapsed));
  const [zigRow, setZigRow] = useState<CurrencyRow>(() => emptyRow(monthsElapsed));
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadNonce, setLoadNonce] = useState(0);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [, bump] = useReducer((n: number) => n + 1, 0);

  // The full 12-month year, independent of how many months the current
  // quarter's window shows.
  const savedUsdMonths = useRef<number[]>(Array(12).fill(0));
  const savedZigMonths = useRef<number[]>(Array(12).fill(0));

  // What the server already holds for this year (1-based month numbers) and
  // which of those were saved as estimates.
  const serverMonths = useRef<Set<number>>(new Set());
  const serverEstimate = useRef<boolean[]>(Array(12).fill(false));

  // Months (0-based) the person has actually typed into this session. The
  // autosave only ever runs after a real edit - it must NEVER fire just
  // because the component mounted, or a slow load lets an empty grid
  // overwrite months saved at an earlier QPD.
  const touched = useRef<Set<number>>(new Set());

  const pending = useRef<PendingSave | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function doSave(): Promise<boolean> {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const p = pending.current;
    if (!p) return true;
    pending.current = null;
    if (p.entries.length === 0) return true;
    setSaveStatus("saving");
    try {
      await api.saveMonthlyIncome(p.businessId, p.taxYear, p.entries);
      for (const e of p.entries) {
        serverMonths.current.add(e.month);
        serverEstimate.current[e.month - 1] = e.is_estimate;
      }
      setSaveStatus("saved");
      bump();
      return true;
    } catch {
      // Keep the unsaved edit so the next flush/edit retries it.
      pending.current = pending.current ?? p;
      setSaveStatus("error");
      return false;
    }
  }

  // Latest doSave for the unmount/unload paths (closes over refs only).
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  useImperativeHandle(ref, () => ({ flush: () => doSaveRef.current() }), []);

  // Anything still queued when the component goes away (e.g. the person hits
  // Calculate within 900ms of their last keystroke and the page navigates)
  // is sent immediately instead of being dropped with the timer.
  useEffect(() => {
    return () => {
      if (pending.current) void doSaveRef.current();
    };
  }, []);

  // Load whatever is already saved for this business/tax year, so months
  // entered while filing an earlier QPD carry forward. Deliberately has no
  // "already loaded" guard: the cancelled flag handles stale responses, and a
  // guard here would swallow the result under React StrictMode's
  // mount/unmount/mount cycle.
  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");

    savedUsdMonths.current = Array(12).fill(0);
    savedZigMonths.current = Array(12).fill(0);
    serverMonths.current = new Set();
    serverEstimate.current = Array(12).fill(false);
    touched.current = new Set();
    setUsdRow((prev) => emptyRow(prev.months.length));
    setZigRow((prev) => emptyRow(prev.months.length));

    api
      .getMonthlyIncome(businessId, taxYear)
      .then((saved) => {
        if (cancelled) return;
        const usdMonths: number[] = Array(12).fill(0);
        const zigMonths: number[] = Array(12).fill(0);
        const onServer = new Set<number>();
        const est: boolean[] = Array(12).fill(false);
        for (const e of saved) {
          if (e.month < 1 || e.month > 12) continue;
          usdMonths[e.month - 1] = e.usd_amount;
          zigMonths[e.month - 1] = e.zig_amount;
          onServer.add(e.month);
          est[e.month - 1] = e.is_estimate;
        }
        savedUsdMonths.current = usdMonths;
        savedZigMonths.current = zigMonths;
        serverMonths.current = onServer;
        serverEstimate.current = est;
        setUsdRow((prev) => ({ ...prev, months: usdMonths.slice(0, prev.months.length) }));
        setZigRow((prev) => ({ ...prev, months: zigMonths.slice(0, prev.months.length) }));
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });

    return () => {
      cancelled = true;
      // Switching year/business: don't lose an edit queued for the old one.
      if (pending.current) void doSaveRef.current();
    };
  }, [businessId, taxYear, loadNonce]);

  // Changing quarter changes how many months are in play - keep whatever
  // overlaps and fill newly-revealed months from the saved record.
  useEffect(() => {
    setUsdRow((prev) => ({ ...prev, months: resizeMonths(prev.months, monthsElapsed, savedUsdMonths.current) }));
    setZigRow((prev) => ({ ...prev, months: resizeMonths(prev.months, monthsElapsed, savedZigMonths.current) }));
  }, [monthsElapsed]);

  // Keep the 12-month record in step with what's on screen, so shrinking and
  // re-growing the window in one session restores the latest edits.
  useEffect(() => {
    if (loadState !== "ready") return;
    usdRow.months.forEach((v, i) => {
      savedUsdMonths.current[i] = v;
    });
  }, [usdRow.months, loadState]);

  useEffect(() => {
    if (loadState !== "ready") return;
    zigRow.months.forEach((v, i) => {
      savedZigMonths.current[i] = v;
    });
  }, [zigRow.months, loadState]);

  const usdAnnual = useMemo(() => computeAnnual(usdRow, monthsElapsed).buffered, [usdRow, monthsElapsed]);
  const zigAnnual = useMemo(() => computeAnnual(zigRow, monthsElapsed).buffered, [zigRow, monthsElapsed]);

  useEffect(() => {
    if (!manual) {
      onUsdChange(roundToCents(usdAnnual));
      onZigChange(roundToCents(zigAnnual));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usdAnnual, zigAnnual, manual]);

  const blocked = !manual && loadState !== "ready";
  useEffect(() => {
    onBlockedChange?.(blocked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked]);

  // Debounced autosave - only after a genuine edit, only once the saved
  // months have loaded, and only for months that carry a figure, were
  // touched, or already exist on the server (no phantom zero rows).
  useEffect(() => {
    if (loadState !== "ready" || touched.current.size === 0) return;

    const last = usdRow.months.length - 1;
    const entries: MonthlyIncomeEntry[] = [];
    usdRow.months.forEach((usd, i) => {
      const zig = zigRow.months[i] ?? 0;
      if (usd !== 0 || zig !== 0 || touched.current.has(i) || serverMonths.current.has(i + 1)) {
        entries.push({ month: i + 1, usd_amount: usd, zig_amount: zig, is_estimate: i === last });
      }
    });
    pending.current = { businessId, taxYear, entries };
    setSaveStatus("saving");

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void doSaveRef.current();
    }, 900);

    return () => {
      // Only cancels the timer; the queued edit itself stays in `pending`
      // until it is sent (timer, flush(), or unmount).
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usdRow.months, zigRow.months, loadState]);

  const carried = useMemo(() => {
    if (loadState !== "ready") return [];
    return Array.from(serverMonths.current)
      .filter((m) => m <= monthsElapsed)
      .sort((a, b) => a - b)
      .map((m) => MONTH_NAMES[m - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState, monthsElapsed, saveStatus]);

  function onTouch(index: number) {
    if (!touched.current.has(index)) {
      touched.current.add(index);
      bump();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-faint">
          Actual sales for closed months, your best guess for the month still in progress.
          Annualized on a pro-rata basis. Saved automatically and carried forward to your next
          QPD this tax year.
        </p>
        <div className="flex shrink-0 items-center gap-3">
          {saveStatus === "saving" && <span className="text-xs text-ink-faint">Saving...</span>}
          {saveStatus === "saved" && <span className="text-xs text-usd">Saved</span>}
          {saveStatus === "error" && <span className="text-xs text-danger">Not saved - will retry</span>}
          <button
            type="button"
            onClick={() => setManual((m) => !m)}
            className="text-xs font-medium text-seal"
          >
            {manual ? "Use monthly calculator" : "Enter annual figure manually"}
          </button>
        </div>
      </div>

      {manual ? (
        <p className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-ink-faint">
          Manual mode - use the USD sales / ZiG sales fields above directly. Switch back any time;
          your monthly entries here aren&apos;t lost.
        </p>
      ) : loadState === "loading" ? (
        <div className="rounded-md border border-dashed border-line px-3 py-6 text-center text-xs text-ink-faint">
          Loading the months you saved earlier this year...
        </div>
      ) : loadState === "error" ? (
        <div className="space-y-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-3 text-sm">
          <p className="text-danger">
            Couldn&apos;t load the months you saved earlier this year. Nothing has been changed.
          </p>
          <button
            type="button"
            onClick={() => setLoadNonce((n) => n + 1)}
            className="rounded-md bg-danger px-3 py-1.5 text-xs font-semibold text-paper"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          {carried.length > 0 && (
            <p className="text-xs text-usd">Carried forward from earlier this year: {carried.join(", ")}.</p>
          )}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">USD</p>
              <CurrencyColumn
                currency="USD"
                monthsElapsed={monthsElapsed}
                row={usdRow}
                setRow={setUsdRow}
                wasEstimate={serverEstimate.current}
                touched={touched.current}
                onTouch={onTouch}
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">ZiG</p>
              <CurrencyColumn
                currency="ZIG"
                monthsElapsed={monthsElapsed}
                row={zigRow}
                setRow={setZigRow}
                wasEstimate={serverEstimate.current}
                touched={touched.current}
                onTouch={onTouch}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
});
