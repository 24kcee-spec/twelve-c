"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { MonthlyIncomeEntry } from "@/lib/types";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// How many months are "in play" by each QPD's due date - the last one is
// always the estimate (the quarter isn't over yet when you file), the rest
// are actuals. QPD4 (due 20 Dec) covers all 12 months, so its last month
// is really "almost actual" but still treated as an estimate slot since
// December isn't closed on the 20th.
const MONTHS_ELAPSED_BY_QUARTER: Record<number, number> = { 1: 3, 2: 6, 3: 9, 4: 12 };

interface CurrencyRow {
  months: number[]; // length = monthsElapsed, last index is the estimate
  oneOff: number;
  bufferPct: number;
}

function emptyRow(monthsElapsed: number): CurrencyRow {
  return { months: Array(monthsElapsed).fill(0), oneOff: 0, bufferPct: 0 };
}

function resizeMonths(months: number[], targetLength: number, canonical: number[]): number[] {
  if (months.length === targetLength) return months;
  if (months.length > targetLength) return months.slice(0, targetLength);
  // Growing the window (e.g. QPD1 -> QPD2): restore each newly-revealed
  // slot from the full 12-month canonical record instead of zero-filling.
  // Zero-filling here used to mean "switch to a later quarter" silently
  // wiped any actuals you'd already saved for those months, because the
  // debounced autosave below would then push those zeros back to the
  // server a moment later.
  const extra = canonical.slice(months.length, targetLength);
  return [...months, ...extra];
}

function computeAnnual(row: CurrencyRow, monthsElapsed: number) {
  const sum = row.months.reduce((a, b) => a + b, 0);
  const avg = monthsElapsed > 0 ? sum / monthsElapsed : 0;
  const base = avg * 12;
  const adjusted = base + row.oneOff;
  const buffered = adjusted * (1 + row.bufferPct / 100);
  return { sum, base, adjusted, buffered };
}

function CurrencyColumn({
  currency,
  monthsElapsed,
  row,
  setRow,
}: {
  currency: "USD" | "ZIG";
  monthsElapsed: number;
  row: CurrencyRow;
  setRow: (row: CurrencyRow) => void;
}) {
  const result = computeAnnual(row, monthsElapsed);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {row.months.map((val, i) => {
          const isEstimate = i === row.months.length - 1;
          return (
            <label key={i} className="block">
              <span className="mb-1 flex items-center justify-between text-xs text-ink-faint">
                <span>{MONTH_NAMES[i]}</span>
                <span className={isEstimate ? "text-seal" : ""}>{isEstimate ? "Estimate" : "Actual"}</span>
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={val === 0 ? "" : val}
                placeholder="0.00"
                onChange={(e) => {
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

export function MonthlyIncomeCalculator({
  businessId,
  taxYear,
  quarter,
  onUsdChange,
  onZigChange,
}: {
  businessId: string;
  taxYear: number;
  quarter: number;
  onUsdChange: (v: number) => void;
  onZigChange: (v: number) => void;
}) {
  const monthsElapsed = MONTHS_ELAPSED_BY_QUARTER[quarter] ?? 3;
  const [manual, setManual] = useState(false);
  const [usdRow, setUsdRow] = useState<CurrencyRow>(() => emptyRow(monthsElapsed));
  const [zigRow, setZigRow] = useState<CurrencyRow>(() => emptyRow(monthsElapsed));
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedKey = useRef<string | null>(null);

  // The full 12-month year, independent of how many months the current
  // quarter's window shows. This is what resizeMonths() reads from when
  // the window grows - see the comment there for why that matters.
  const savedUsdMonths = useRef<number[]>(Array(12).fill(0));
  const savedZigMonths = useRef<number[]>(Array(12).fill(0));

  // Load whatever's already saved for this business/tax_year so actuals
  // entered while filing an earlier QPD this year carry forward instead
  // of being re-typed. Re-fetches whenever the tax year changes; the
  // month count changing (different quarter, same year) just reslices
  // what's already loaded rather than re-fetching.
  useEffect(() => {
    const key = `${businessId}:${taxYear}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;

    let cancelled = false;
    api
      .getMonthlyIncome(businessId, taxYear)
      .then((saved) => {
        if (cancelled || saved.length === 0) return;
        const usdMonths = Array(12).fill(0);
        const zigMonths = Array(12).fill(0);
        for (const e of saved) {
          usdMonths[e.month - 1] = e.usd_amount;
          zigMonths[e.month - 1] = e.zig_amount;
        }
        savedUsdMonths.current = usdMonths;
        savedZigMonths.current = zigMonths;
        setUsdRow((prev) => ({ ...prev, months: usdMonths.slice(0, prev.months.length) }));
        setZigRow((prev) => ({ ...prev, months: zigMonths.slice(0, prev.months.length) }));
      })
      .catch(() => {
        // No saved data yet, or a transient error - the form still works
        // fine starting from blank/zero, so this fails silently.
      });

    return () => {
      cancelled = true;
    };
  }, [businessId, taxYear]);

  // Changing quarter changes how many months are in play - keep whatever
  // overlaps (e.g. moving from QPD1 to QPD2 keeps Jan-Mar) and pad the
  // rest with zeros, rather than wiping entered data.
  useEffect(() => {
    setUsdRow((prev) => ({ ...prev, months: resizeMonths(prev.months, monthsElapsed, savedUsdMonths.current) }));
    setZigRow((prev) => ({ ...prev, months: resizeMonths(prev.months, monthsElapsed, savedZigMonths.current) }));
  }, [monthsElapsed]);

  // Keep the canonical 12-month record current with whatever's on screen,
  // so if the window shrinks (e.g. QPD2 -> QPD1) and then grows again in
  // the same session, growing restores your latest edits rather than the
  // stale snapshot from when the page first loaded.
  useEffect(() => {
    usdRow.months.forEach((v, i) => {
      savedUsdMonths.current[i] = v;
    });
  }, [usdRow.months]);

  useEffect(() => {
    zigRow.months.forEach((v, i) => {
      savedZigMonths.current[i] = v;
    });
  }, [zigRow.months]);

  const usdAnnual = useMemo(() => computeAnnual(usdRow, monthsElapsed).buffered, [usdRow, monthsElapsed]);
  const zigAnnual = useMemo(() => computeAnnual(zigRow, monthsElapsed).buffered, [zigRow, monthsElapsed]);

  useEffect(() => {
    if (!manual) {
      onUsdChange(Math.round(usdAnnual * 100) / 100);
      onZigChange(Math.round(zigAnnual * 100) / 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usdAnnual, zigAnnual, manual]);

  // Debounced save - fires 900ms after the last edit to either row rather
  // than on every keystroke.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const entries: MonthlyIncomeEntry[] = usdRow.months.map((usd, i) => ({
        month: i + 1,
        usd_amount: usd,
        zig_amount: zigRow.months[i] ?? 0,
        is_estimate: i === usdRow.months.length - 1,
      }));
      setSaveStatus("saving");
      api
        .saveMonthlyIncome(businessId, taxYear, entries)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("idle"));
    }, 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usdRow, zigRow]);

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
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">USD</p>
            <CurrencyColumn currency="USD" monthsElapsed={monthsElapsed} row={usdRow} setRow={setUsdRow} />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">ZiG</p>
            <CurrencyColumn currency="ZIG" monthsElapsed={monthsElapsed} row={zigRow} setRow={setZigRow} />
          </div>
        </div>
      )}
    </div>
  );
}