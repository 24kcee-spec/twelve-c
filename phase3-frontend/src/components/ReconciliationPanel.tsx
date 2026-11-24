"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { money, percent } from "@/lib/format";
import { ApiError, BusinessCompliance, QpdCalculationOut, QuarterBreakdown } from "@/lib/types";
import { Button } from "@/components/ui";

function moneyOrDash(value: number | null, currency: "USD" | "ZIG"): string {
  return value === null ? "\u2014" : money(value, currency);
}

function parseNonNegative(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

type DraftMap = Record<string, { usd: string; zig: string }>;

function draftsFromQuarters(quarters: QuarterBreakdown[]): DraftMap {
  const next: DraftMap = {};
  for (const q of quarters) {
    if (!q.has_calculation || !q.calculation_id) continue;
    const confirmed = Boolean(q.payment_confirmed_at);
    next[q.calculation_id] = {
      usd: confirmed ? String(q.actual_usd_paid ?? 0) : "",
      zig: confirmed ? String(q.actual_zig_paid ?? 0) : "",
    };
  }
  return next;
}

export function ReconciliationPanel({
  businessId,
  taxYear,
  calculations,
  onConfirmPayment,
}: {
  businessId: string;
  taxYear: number;
  calculations?: QpdCalculationOut[];
  onConfirmPayment?: (calcId: string, actualUsdPaid: number, actualZigPaid: number) => Promise<void>;
}) {
  const [data, setData] = useState<BusinessCompliance | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<"excel" | "pdf" | null>(null);
  const [downloadError, setDownloadError] = useState("");

  const [drafts, setDrafts] = useState<DraftMap>({});
  const [savingCalcId, setSavingCalcId] = useState<string | null>(null);
  const [savedCalcId, setSavedCalcId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [localSyncCounter, setLocalSyncCounter] = useState(0);

  const syncSignature = useMemo(() => {
    if (!calculations) return "standalone";
    return calculations
      .filter((c) => c.tax_year === taxYear)
      .map(
        (c) =>
          `${c.id}:${c.payment_confirmed_at ?? ""}:${c.actual_usd_paid ?? ""}:${c.actual_zig_paid ?? ""}`
      )
      .sort()
      .join("|");
  }, [calculations, taxYear]);

  useEffect(() => {
    let cancelled = false;
    if (!data || data.tax_year !== taxYear || data.business_id !== businessId) {
      setLoading(true);
    }
    setError("");

    api
      .getCompliance(businessId, taxYear)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setDrafts(draftsFromQuarters(d.quarters));
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the reconciliation view.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, taxYear, syncSignature, localSyncCounter]);

  async function handleDownload(kind: "excel" | "pdf") {
    setDownloading(kind);
    setDownloadError("");
    try {
      if (kind === "excel") {
        await api.downloadWorkingPapersExcel(businessId, taxYear);
      } else {
        await api.downloadWorkingPapersPdf(businessId, taxYear);
      }
    } catch (err) {
      const message = err instanceof ApiError ? String(err.detail ?? "Download failed.") : "Download failed.";
      setDownloadError(message);
    } finally {
      setDownloading(null);
    }
  }

  function updateDraft(calcId: string, field: "usd" | "zig", value: string) {
    setDrafts((prev) => ({
      ...prev,
      [calcId]: {
        usd: field === "usd" ? value : (prev[calcId]?.usd ?? ""),
        zig: field === "zig" ? value : (prev[calcId]?.zig ?? ""),
      },
    }));
    setSavedCalcId((curr) => (curr === calcId ? null : curr));
    setRowError((prev) => {
      if (!prev[calcId]) return prev;
      const copy = { ...prev };
      delete copy[calcId];
      return copy;
    });
  }

  function fillQuarterDue(q: QuarterBreakdown) {
    if (!q.calculation_id) return;
    setDrafts((prev) => ({
      ...prev,
      [q.calculation_id!]: {
        usd: (q.net_due_usd ?? 0).toFixed(2),
        zig: (q.net_due_zig ?? 0).toFixed(2),
      },
    }));
    setSavedCalcId((curr) => (curr === q.calculation_id ? null : curr));
  }

  async function saveQuarterPayment(q: QuarterBreakdown) {
    if (!q.calculation_id) return;
    const calcId = q.calculation_id;
    const draft = drafts[calcId] ?? { usd: "", zig: "" };
    const usdPaid = parseNonNegative(draft.usd);
    const zigPaid = parseNonNegative(draft.zig);

    setSavingCalcId(calcId);
    setSavedCalcId(null);
    setRowError((prev) => {
      const copy = { ...prev };
      delete copy[calcId];
      return copy;
    });

    try {
      if (onConfirmPayment) {
        await onConfirmPayment(calcId, usdPaid, zigPaid);
      } else {
        await api.confirmActualPayment(businessId, calcId, {
          actual_usd_paid: usdPaid,
          actual_zig_paid: zigPaid,
        });
        setLocalSyncCounter((n) => n + 1);
      }
      setSavedCalcId(calcId);
    } catch {
      setRowError((prev) => ({
        ...prev,
        [calcId]: "Couldn't save payment.",
      }));
    } finally {
      setSavingCalcId(null);
    }
  }

  // Detect any later calculated quarter whose stored previous_paid_* no longer
  // matches the sum of confirmed payments from earlier quarters.
  const staleCarryForwardQuarters = useMemo(() => {
    if (!data) return [];
    const stale: number[] = [];
    for (const q of data.quarters) {
      if (!q.has_calculation || q.quarter <= 1) continue;
      let priorUsd = 0;
      let priorZig = 0;
      for (const prev of data.quarters) {
        if (prev.quarter < q.quarter && prev.has_calculation && prev.payment_confirmed_at) {
          priorUsd += prev.actual_usd_paid ?? 0;
          priorZig += prev.actual_zig_paid ?? 0;
        }
      }
      if (
        Math.abs((q.previous_paid_usd ?? 0) - priorUsd) > 0.02 ||
        Math.abs((q.previous_paid_zig ?? 0) - priorZig) > 0.02
      ) {
        stale.push(q.quarter);
      }
    }
    return stale;
  }, [data]);

  if (loading) {
    return <div className="h-40 animate-pulse border border-line bg-surface" />;
  }

  if (error) {
    return (
      <div className="border border-line bg-surface p-4">
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  if (!data.has_data) {
    return (
      <div className="border border-line bg-surface p-4 sm:p-6">
        <div className="font-mono text-[10px] tracking-wide text-ink-faint">
          RECONCILIATION {"\u00B7"} {taxYear}
        </div>
        <p className="mt-2 text-sm text-ink-faint">
          Run a QPD calculation for {taxYear} to see your quarter-by-quarter reconciliation.
        </p>
      </div>
    );
  }

  const totalConfirmedUsd = data.quarters
    .filter((q) => q.has_calculation && q.payment_confirmed_at)
    .reduce((sum, q) => sum + (q.actual_usd_paid ?? 0), 0);
  const totalConfirmedZig = data.quarters
    .filter((q) => q.has_calculation && q.payment_confirmed_at)
    .reduce((sum, q) => sum + (q.actual_zig_paid ?? 0), 0);

  const totalRemainingUsd = data.quarters
    .filter((q) => q.has_calculation)
    .reduce((sum, q) => {
      const paid = q.payment_confirmed_at ? (q.actual_usd_paid ?? 0) : 0;
      return sum + Math.max(0, (q.net_due_usd ?? 0) - paid);
    }, 0);
  const totalRemainingZig = data.quarters
    .filter((q) => q.has_calculation)
    .reduce((sum, q) => {
      const paid = q.payment_confirmed_at ? (q.actual_zig_paid ?? 0) : 0;
      return sum + Math.max(0, (q.net_due_zig ?? 0) - paid);
    }, 0);

  const unconfirmedQuarters = data.quarters
    .filter((q) => q.has_calculation && !q.payment_confirmed_at)
    .map((q) => q.quarter_label || `Q${q.quarter}`);

  return (
    <div className="border border-ink/15 bg-surface">
      {/* Top summary strip synced with payments */}
      <div className="grid grid-cols-1 divide-y divide-line border-b border-ink/15 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-3.5 sm:px-5">
          <div className="text-xs text-ink-faint">Confirmed paid ({taxYear})</div>
          <div className="mt-1 font-display text-xl font-medium tabular-nums text-seal">
            {money(totalConfirmedUsd, "USD")}
          </div>
          <div className="font-mono text-xs tabular-nums text-ink-soft">{money(totalConfirmedZig, "ZIG")}</div>
        </div>
        <div className="px-4 py-3.5 sm:px-5">
          <div className="text-xs text-ink-faint">Still owing (calculated quarters)</div>
          <div
            className={`mt-1 font-display text-xl font-medium tabular-nums ${
              totalRemainingUsd > 0.01 || totalRemainingZig > 0.01 ? "text-danger" : "text-seal"
            }`}
          >
            {money(totalRemainingUsd, "USD")}
          </div>
          <div className="font-mono text-xs tabular-nums text-ink-soft">{money(totalRemainingZig, "ZIG")}</div>
        </div>
        <div className="px-4 py-3.5 sm:px-5">
          <div className="text-xs text-ink-faint">Est. annual tax (latest run)</div>
          <div className="mt-1 font-display text-xl font-medium tabular-nums text-ink">
            {money(data.usd?.reference_tax ?? 0, "USD")}
          </div>
          <div className="font-mono text-xs tabular-nums text-ink-soft">
            {money(data.zig?.reference_tax ?? 0, "ZIG")}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-mono text-[10px] tracking-wide text-ink-faint">
            QUARTER-BY-QUARTER {"\u00B7"} {taxYear}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleDownload("excel")}
              disabled={downloading !== null}
            >
              {downloading === "excel" ? "Preparing\u2026" : "Download Working Papers (Excel)"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleDownload("pdf")}
              disabled={downloading !== null}
            >
              {downloading === "pdf" ? "Preparing\u2026" : "Download Working Papers (PDF)"}
            </Button>
          </div>
        </div>

        {unconfirmedQuarters.length > 0 && (
          <div className="mt-3 rounded border border-zig/30 bg-zig-soft px-3 py-2 text-xs text-ink-soft">
            Unrecorded payments for{" "}
            <span className="font-semibold text-ink">{unconfirmedQuarters.join(", ")}</span>. Write down
            what you actually paid inline below and save so your reconciliation stays up to date.
          </div>
        )}

        {staleCarryForwardQuarters.length > 0 && (
          <div className="mt-2 rounded border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            Prior-quarter payments changed after{" "}
            {staleCarryForwardQuarters.map((q) => `QPD${q}`).join(", ")}{" "}
            {staleCarryForwardQuarters.length === 1 ? "was" : "were"} calculated. Delete and recalculate{" "}
            {staleCarryForwardQuarters.length === 1 ? "that quarter" : "those quarters"} if you need the
            carried-forward net due recalculated.
          </div>
        )}

        {downloadError && <p className="mt-2 text-xs text-danger">{downloadError}</p>}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] tracking-wide text-ink-faint">
                <th className="py-2 pr-3 font-medium">QUARTER</th>
                <th className="py-2 pr-3 font-medium">DUE</th>
                <th className="py-2 pr-3 text-right font-medium">CUM%</th>
                <th className="py-2 pr-3 text-right font-medium">NET DUE</th>
                <th className="py-2 px-3 font-medium">WHAT YOU PAID</th>
                <th className="py-2 pl-3 text-right font-medium">BALANCE</th>
              </tr>
            </thead>
            <tbody>
              {data.quarters.map((q) => {
                if (!q.has_calculation || !q.calculation_id) {
                  return (
                    <tr
                      key={q.quarter}
                      className="border-b border-line/60 font-mono text-xs opacity-50 last:border-b-0"
                    >
                      <td className="py-3 pr-3 font-semibold text-ink">{q.quarter_label || `Q${q.quarter}`}</td>
                      <td className="py-3 pr-3 text-ink-faint">{q.due_date}</td>
                      <td className="py-3 pr-3 text-right text-ink-faint">{"\u2014"}</td>
                      <td className="py-3 pr-3 text-right text-ink-faint">{"\u2014"}</td>
                      <td className="py-3 px-3 text-ink-faint">Not yet calculated</td>
                      <td className="py-3 pl-3 text-right text-ink-faint">{"\u2014"}</td>
                    </tr>
                  );
                }

                const calcId = q.calculation_id;
                const draft = drafts[calcId] ?? { usd: "", zig: "" };
                const confirmed = Boolean(q.payment_confirmed_at);
                const draftUsd = parseNonNegative(draft.usd);
                const draftZig = parseNonNegative(draft.zig);
                const netDueUsd = q.net_due_usd ?? 0;
                const netDueZig = q.net_due_zig ?? 0;
                const remUsd = Math.max(0, netDueUsd - draftUsd);
                const remZig = Math.max(0, netDueZig - draftZig);

                const savedPaidUsd = confirmed ? (q.actual_usd_paid ?? 0) : 0;
                const savedPaidZig = confirmed ? (q.actual_zig_paid ?? 0) : 0;
                const isDirty = !confirmed
                  ? draft.usd.trim() !== "" || draft.zig.trim() !== ""
                  : Math.abs(draftUsd - savedPaidUsd) > 0.001 || Math.abs(draftZig - savedPaidZig) > 0.001;

                const isSettled =
                  (netDueUsd <= 0.01 && netDueZig <= 0.01) ||
                  (confirmed &&
                    netDueUsd - savedPaidUsd <= 0.01 &&
                    netDueZig - savedPaidZig <= 0.01 &&
                    !isDirty);

                const isSaving = savingCalcId === calcId;
                const isSaved = savedCalcId === calcId;

                return (
                  <tr
                    key={q.quarter}
                    className="border-b border-line/60 align-top font-mono text-xs last:border-b-0"
                  >
                    <td className="py-3 pr-3 font-semibold text-ink">
                      <div>{q.quarter_label || `Q${q.quarter}`}</div>
                      {!confirmed ? (
                        <span className="mt-1 inline-block rounded bg-danger-soft px-1.5 py-0.5 text-[10px] font-medium text-danger">
                          Unpaid
                        </span>
                      ) : isSettled ? (
                        <span className="mt-1 inline-block rounded bg-seal-soft px-1.5 py-0.5 text-[10px] font-medium text-seal">
                          Paid
                        </span>
                      ) : (
                        <span className="mt-1 inline-block rounded bg-zig-soft px-1.5 py-0.5 text-[10px] font-medium text-zig">
                          Partial
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-ink-faint">{q.due_date}</td>
                    <td className="py-3 pr-3 text-right text-ink-faint">
                      {q.cumulative_percentage !== null ? percent(q.cumulative_percentage) : "\u2014"}
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums">
                      <div className="font-semibold text-ink">{moneyOrDash(q.net_due_usd, "USD")}</div>
                      <div className="text-ink-faint">{moneyOrDash(q.net_due_zig, "ZIG")}</div>
                      <div className="mt-1 text-[10px] text-ink-faint">
                        Cum req: {moneyOrDash(q.required_cumulative_tax_usd, "USD")}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <label className="flex items-center gap-1">
                          <span className="text-[10px] text-ink-faint">USD</span>
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            aria-label={`${q.quarter_label || `Q${q.quarter}`} USD paid`}
                            placeholder="0.00"
                            value={draft.usd}
                            onChange={(e) => updateDraft(calcId, "usd", e.target.value)}
                            className="w-24 rounded border border-line bg-paper px-2 py-1 text-right font-mono text-xs tabular-nums text-ink outline-none focus:border-seal"
                          />
                        </label>
                        <label className="flex items-center gap-1">
                          <span className="text-[10px] text-ink-faint">ZiG</span>
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            aria-label={`${q.quarter_label || `Q${q.quarter}`} ZiG paid`}
                            placeholder="0.00"
                            value={draft.zig}
                            onChange={(e) => updateDraft(calcId, "zig", e.target.value)}
                            className="w-24 rounded border border-line bg-paper px-2 py-1 text-right font-mono text-xs tabular-nums text-ink outline-none focus:border-seal"
                          />
                        </label>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => saveQuarterPayment(q)}
                          disabled={isSaving}
                          className={`rounded px-2 py-1 text-[11px] font-semibold transition ${
                            isDirty || !confirmed
                              ? "bg-ink text-paper hover:bg-seal hover:text-ink"
                              : "border border-line bg-surface-2 text-ink-soft hover:border-ink hover:text-ink"
                          } disabled:opacity-50`}
                        >
                          {isSaving ? "Saving..." : confirmed ? "Save" : "Record payment"}
                        </button>
                        <button
                          type="button"
                          onClick={() => fillQuarterDue(q)}
                          className="text-[11px] font-medium text-brass hover:underline"
                        >
                          Fill due
                        </button>
                        {isSaved && !isSaving && (
                          <span className="text-[11px] font-medium text-seal">Saved</span>
                        )}
                      </div>
                      {rowError[calcId] && (
                        <p className="mt-1 text-[11px] text-danger">{rowError[calcId]}</p>
                      )}
                    </td>
                    <td className="py-3 pl-3 text-right tabular-nums">
                      {remUsd <= 0.01 && remZig <= 0.01 && (confirmed || (netDueUsd <= 0.01 && netDueZig <= 0.01)) ? (
                        <span className="font-semibold text-seal">Paid in full</span>
                      ) : (
                        <>
                          <div className={remUsd > 0.01 ? "font-semibold text-danger" : "text-seal"}>
                            {money(remUsd, "USD")}
                          </div>
                          <div className={remZig > 0.01 ? "text-danger" : "text-ink-faint"}>
                            {money(remZig, "ZIG")}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-ink-faint">
          Enter what you actually remitted to ZIMRA for each calculated quarter and save. Confirmed
          payments stay in sync with your Overview and automatically reduce future quarters&apos; net
          payable.
        </p>
      </div>
    </div>
  );
}