"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { ResultsPanel } from "@/components/ResultsPanel";
import { PaymentTracker } from "@/components/PaymentTracker";
import { NextPaymentDue } from "@/components/NextPaymentDue";
import { QuarterStrip } from "@/components/QuarterStrip";
import { ReconciliationPanel } from "@/components/ReconciliationPanel";
import { downloadTaxSummaryPdf } from "@/lib/generatePdf";
import { Badge, Button, Card, ChevronDown, ErrorNote, Eyebrow, TrashIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, money } from "@/lib/format";
import { Business, QpdCalculationOut } from "@/lib/types";

// This page used to also hold the "New QPD calculation" wizard, with
// results squeezed into a sticky column beside it. That form now lives at
// /dashboard/[businessId]/new as its own page. This page is Overview only:
// current status at a glance, full-width results, and history. Nothing
// here scrolls past a single screen on a normal laptop viewport.
function BusinessContent({ businessId }: { businessId: string }) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [calculations, setCalculations] = useState<QpdCalculationOut[]>([]);
  const [selected, setSelected] = useState<QpdCalculationOut | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"overview" | "reconciliation" | "history">("overview");

  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const yearsInitialized = useRef(false);
  const [confirmingDeleteCalcId, setConfirmingDeleteCalcId] = useState<string | null>(null);
  const [deletingCalcId, setDeletingCalcId] = useState<string | null>(null);

  async function loadAll() {
    try {
      const [b, calcs] = await Promise.all([
        api.getBusiness(businessId),
        api.listCalculations(businessId),
      ]);
      setBusiness(b);
      setCalculations(calcs);
      if (calcs.length > 0) setSelected(calcs[0]);
      if (!yearsInitialized.current && calcs.length > 0) {
        setExpandedYears(new Set([calcs[0].tax_year]));
        yearsInitialized.current = true;
      }
    } catch {
      setError("Couldn't load this business.");
    }
  }

  useEffect(() => {
    yearsInitialized.current = false;
    setExpandedYears(new Set());
    setConfirmingDeleteCalcId(null);
    setDeletingCalcId(null);
    setSelected(null);
    setError("");
    setTab("overview");
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const groupedCalculations = useMemo(() => {
    const groups: { year: number; items: QpdCalculationOut[] }[] = [];
    for (const c of calculations) {
      const current = groups[groups.length - 1];
      if (current && current.year === c.tax_year) current.items.push(c);
      else groups.push({ year: c.tax_year, items: [c] });
    }
    return groups;
  }, [calculations]);

  const latestCalculationId = calculations[0]?.id ?? null;

  function toggleYear(year: number) {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  async function onDeleteCalculation(calc: QpdCalculationOut) {
    setDeletingCalcId(calc.id);
    setError("");
    try {
      await api.deleteCalculation(businessId, calc.id);
      setCalculations((prev) => {
        const next = prev.filter((c) => c.id !== calc.id);
        if (selected?.id === calc.id) setSelected(next[0] ?? null);
        return next;
      });
      setConfirmingDeleteCalcId(null);
    } catch {
      setError("Couldn't delete that calculation. Try again in a moment.");
    } finally {
      setDeletingCalcId(null);
    }
  }

  async function onSavePayments(usdPaid: number[], zigPaid: number[]) {
    if (!selected) return;
    const updated = await api.applyPayments(businessId, selected.id, {
      usd_paid: usdPaid,
      zig_paid: zigPaid,
    });
    setSelected(updated);
    setCalculations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  if (!business) {
    return (
      <main className="min-h-screen bg-paper">
        <TopBar />
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <ErrorNote>{error}</ErrorNote>
          {!error && (
            <div className="space-y-4">
              <div className="h-32 animate-pulse rounded-lg border border-line bg-surface" />
              <div className="h-64 animate-pulse rounded-lg border border-line bg-surface" />
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-paper">
      <TopBar />
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-seal font-mono text-base font-semibold text-ink">
              {business.name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase())
                .join("") || "?"}
            </span>
            <div>
              <Eyebrow>Business</Eyebrow>
              <h1 className="mt-0.5 font-display text-2xl text-ink sm:text-3xl">{business.name}</h1>
            </div>
          </div>
          {/* No standing "New calculation" button here any more - each
              quarter card in the strip below is the entry point: an
              uncalculated quarter links straight into the form scoped to
              it, and a calculated one shows its result with an explicit
              delete-to-recalculate action, rather than always offering a
              button that could silently duplicate an already-run quarter. */}
        </div>
        <p className="mt-2 font-mono text-xs text-ink-faint sm:text-sm">
          ZiG {business.default_exchange_rate} / USD · {(business.default_tax_rate * 100).toFixed(0)}% tax
          + {(business.default_aids_levy_rate * 100).toFixed(0)}% AIDS levy
        </p>

        <ErrorNote>{error}</ErrorNote>

        {selected ? (
          <>
            <div className="mt-8 flex gap-5 border-b border-line">
              {(
                [
                  { id: "overview", label: "Overview" },
                  { id: "reconciliation", label: "Reconciliation" },
                  { id: "history", label: "History" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`-mb-px border-b-2 pb-2.5 text-sm font-medium transition duration-150 ${
                    tab === t.id
                      ? "border-seal text-ink"
                      : "border-transparent text-ink-faint hover:text-ink-soft"
                  }`}
                >
                  {t.label}
                  {t.id === "history" && calculations.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-ink-faint/15 px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
                      {calculations.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {tab === "overview" && (
              <div className="mt-6 space-y-6">
                <NextPaymentDue calculations={calculations} taxYear={selected.tax_year} />
                <QuarterStrip
                  businessId={businessId}
                  calculations={calculations}
                  selected={selected}
                  onSelectQuarter={setSelected}
                />

                <div className="flex items-center justify-between gap-3">
                  <Eyebrow>Results · {selected.quarter_label}</Eyebrow>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="secondary" type="button" onClick={() => downloadTaxSummaryPdf(business, selected)}>
                      Download PDF
                    </Button>
                    {confirmingDeleteCalcId === selected.id ? (
                      <div className="flex items-center gap-2 rounded-md bg-danger-soft px-2.5 py-1.5">
                        <span className="text-xs text-danger">Delete this calculation?</span>
                        <button
                          type="button"
                          onClick={() => onDeleteCalculation(selected)}
                          disabled={deletingCalcId === selected.id}
                          className="rounded-md bg-danger px-2 py-1 text-xs font-semibold text-paper disabled:opacity-50"
                        >
                          {deletingCalcId === selected.id ? "Deleting…" : "Yes"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteCalcId(null)}
                          className="rounded-md border border-line px-2 py-1 text-xs text-ink-soft"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteCalcId(selected.id)}
                        className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-faint transition duration-150 hover:border-danger/40 hover:bg-danger-soft hover:text-danger"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                <ResultsPanel
                  result={selected.result_json}
                  taxYear={selected.tax_year}
                  actualUsdPaid={selected.actual_usd_paid}
                  actualZigPaid={selected.actual_zig_paid}
                  paymentsSlot={
                    <PaymentTracker key={selected.id} calculation={selected} onSubmit={onSavePayments} />
                  }
                />
              </div>
            )}

            {tab === "reconciliation" && (
              <div className="mt-6">
                <ReconciliationPanel businessId={businessId} taxYear={selected.tax_year} />
              </div>
            )}

            {tab === "history" && (
              <Card className="mt-6">
                <div className="flex items-center justify-between">
                  <Eyebrow>History</Eyebrow>
                  {calculations.length > 0 && (
                    <span className="font-mono text-xs text-ink-faint">
                      {calculations.length} {calculations.length === 1 ? "entry" : "entries"}
                    </span>
                  )}
                </div>

                {calculations.length === 0 && (
                  <p className="mt-2 text-sm text-ink-faint">No calculations yet.</p>
                )}

                <div className="mt-3 space-y-2">
                  {groupedCalculations.map((group) => {
                    const isExpanded = expandedYears.has(group.year);
                    return (
                      <div key={group.year} className="overflow-hidden rounded-md border border-line">
                        <button
                          type="button"
                          onClick={() => toggleYear(group.year)}
                          aria-expanded={isExpanded}
                          className={`flex w-full items-center justify-between px-3 py-2.5 text-left transition duration-150 ${
                            isExpanded ? "bg-usd-soft" : "bg-surface/40 hover:bg-paper/60"
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <span className="font-display text-base text-ink">{group.year}</span>
                            <span className="rounded-full bg-ink-faint/15 px-2 py-0.5 font-mono text-[10px] text-ink-faint">
                              {group.items.length}
                            </span>
                          </span>
                          <ChevronDown open={isExpanded} />
                        </button>

                        {isExpanded && (
                          <ul className="space-y-1 border-t border-line p-2">
                            {group.items.map((c) => {
                              const isSelected = selected?.id === c.id;
                              const isLatest = c.id === latestCalculationId;
                              const isConfirming = confirmingDeleteCalcId === c.id;

                              if (isConfirming) {
                                return (
                                  <li key={c.id}>
                                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-danger-soft px-3 py-2">
                                      <span className="text-xs text-danger">
                                        Delete this calculation? This can&apos;t be undone.
                                      </span>
                                      <div className="flex shrink-0 gap-2">
                                        <button
                                          type="button"
                                          onClick={() => onDeleteCalculation(c)}
                                          disabled={deletingCalcId === c.id}
                                          className="rounded-md bg-danger px-2.5 py-1 text-xs font-semibold text-paper disabled:opacity-50"
                                        >
                                          {deletingCalcId === c.id ? "Deleting…" : "Yes, delete"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmingDeleteCalcId(null)}
                                          className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-soft"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  </li>
                                );
                              }

                              return (
                                <li key={c.id}>
                                  <div
                                    className={`flex items-center gap-1 rounded-md text-sm transition duration-150 ${
                                      isSelected ? "bg-usd-soft text-usd" : "text-ink-soft hover:bg-surface-2 hover:text-ink"
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelected(c);
                                        setTab("overview");
                                      }}
                                      className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left"
                                    >
                                      <span className="flex min-w-0 flex-col items-start">
                                        <span className="flex items-center gap-2">
                                          <span className="truncate">{c.quarter_label}</span>
                                          {isLatest && <Badge>Latest</Badge>}
                                          {isSelected && <Badge variant="outline">Viewing</Badge>}
                                        </span>
                                        <span className="mt-0.5 font-mono text-[11px] text-ink-faint">
                                          {formatDateTime(c.created_at)}
                                        </span>
                                      </span>
                                      <span className="shrink-0 font-mono tabular-nums">
                                        {money(c.result_json.total_tax_usd, "USD")}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmingDeleteCalcId(c.id)}
                                      aria-label="Delete calculation"
                                      className="mr-1.5 shrink-0 rounded-md p-1.5 text-ink-faint/60 transition duration-150 hover:bg-danger-soft hover:text-danger"
                                    >
                                      <TrashIcon />
                                    </button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </>
        ) : (
          <Card className="mt-8">
            <p className="text-sm text-ink-faint">No calculations yet for this business.</p>
            <Link href={`/dashboard/${businessId}/new`} className="mt-3 inline-block">
              <Button variant="primary">Run your first QPD calculation</Button>
            </Link>
          </Card>
        )}
      </div>
    </main>
  );
}

export default function BusinessPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = params.businessId;

  return (
    <AuthGuard>
      <BusinessContent businessId={businessId} />
    </AuthGuard>
  );
}