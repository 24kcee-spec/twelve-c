"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { ResultsPanel } from "@/components/ResultsPanel";
import { PaymentTracker } from "@/components/PaymentTracker";
import { NextPaymentDue } from "@/components/NextPaymentDue";
import { QuarterStatusStrip } from "@/components/QuarterStatusStrip";
import { downloadTaxSummaryPdf } from "@/lib/generatePdf";
import { Badge, Button, Card, ChevronDown, ErrorNote, Eyebrow, TrashIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { useBusinessData } from "@/lib/useBusinessData";
import { formatDateTime, money } from "@/lib/format";
import { QpdCalculationOut } from "@/lib/types";

function BusinessContent({ businessId }: { businessId: string }) {
  const { business, calculations, setCalculations, error, loading } = useBusinessData(businessId);

  const [selected, setSelected] = useState<QpdCalculationOut | null>(null);
  const [saveError, setSaveError] = useState("");

  // History grouping/delete state. Years start collapsed except the most
  // recent one, which is expanded the first time calculations load.
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const initialized = useRef(false);
  const [confirmingDeleteCalcId, setConfirmingDeleteCalcId] = useState<string | null>(null);
  const [deletingCalcId, setDeletingCalcId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized.current && calculations.length > 0) {
      setSelected(calculations[0]);
      setExpandedYears(new Set([calculations[0].tax_year]));
      initialized.current = true;
    }
  }, [calculations]);

  // Calculations are already ordered by the API (tax_year desc, created_at
  // desc), so same-year entries are contiguous - safe to fold into groups
  // in a single pass without re-sorting on the client.
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
    setSaveError("");
    try {
      await api.deleteCalculation(businessId, calc.id);
      setCalculations((prev) => {
        const next = prev.filter((c) => c.id !== calc.id);
        if (selected?.id === calc.id) setSelected(next[0] ?? null);
        return next;
      });
      setConfirmingDeleteCalcId(null);
    } catch {
      setSaveError("Couldn't delete that calculation. Try again in a moment.");
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

  if (loading && !business) {
    return (
      <main className="min-h-screen bg-paper">
        <TopBar />
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
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

  if (!business) {
    return (
      <main className="min-h-screen bg-paper">
        <TopBar />
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <ErrorNote>{error}</ErrorNote>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-paper">
      <TopBar />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
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
          <div className="flex shrink-0 items-center gap-2">
            {selected && (
              <Button variant="secondary" type="button" onClick={() => downloadTaxSummaryPdf(business, selected)}>
                Download PDF
              </Button>
            )}
            <Link href={`/dashboard/${businessId}/new`}>
              <Button variant="primary" type="button">
                New calculation
              </Button>
            </Link>
          </div>
        </div>
        <p className="mt-2 font-mono text-xs text-ink-faint sm:text-sm">
          ZiG {business.default_exchange_rate} / USD · {(business.default_tax_rate * 100).toFixed(0)}% tax
          + {(business.default_aids_levy_rate * 100).toFixed(0)}% AIDS levy
        </p>

        <ErrorNote>{error || saveError}</ErrorNote>

        {selected ? (
          <div className="mt-8 space-y-6">
            <NextPaymentDue calculation={selected} />
            <QuarterStatusStrip result={selected.result_json} taxYear={selected.tax_year} />
            <ResultsPanel
              result={selected.result_json}
              taxYear={selected.tax_year}
              paymentsSlot={
                <PaymentTracker key={selected.id} calculation={selected} onSubmit={onSavePayments} />
              }
            />
          </div>
        ) : (
          <Card className="mt-8" letterhead>
            <Eyebrow>No calculations yet</Eyebrow>
            <p className="mt-2 text-sm text-ink-soft">
              Run your first QPD calculation for {business.name} to see the breakdown, schedule, and
              payment tracker here.
            </p>
            <Link href={`/dashboard/${businessId}/new`}>
              <Button variant="primary" className="mt-4">
                New calculation
              </Button>
            </Link>
          </Card>
        )}

        <Card className="mt-8">
          <div className="flex items-center justify-between">
            <Eyebrow>History</Eyebrow>
            {calculations.length > 0 && (
              <span className="font-mono text-xs text-ink-faint">
                {calculations.length} {calculations.length === 1 ? "entry" : "entries"}
              </span>
            )}
          </div>

          {calculations.length === 0 && <p className="mt-2 text-sm text-ink-faint">No calculations yet.</p>}

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
                      isExpanded ? "bg-seal-soft" : "bg-surface hover:bg-surface-2"
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
                                isSelected ? "bg-seal-soft text-ink" : "text-ink-soft hover:bg-surface-2 hover:text-ink"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => setSelected(c)}
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
