"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { CurrencyPairInput } from "@/components/CurrencyPairInput";
import { ResultsPanel } from "@/components/ResultsPanel";
import { PaymentTracker } from "@/components/PaymentTracker";
import { NextPaymentDue } from "@/components/NextPaymentDue";
import { TaxSummaryPrint } from "@/components/TaxSummaryPrint";
import { Badge, Button, Card, ChevronDown, ErrorNote, Eyebrow, Field, TrashIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, money } from "@/lib/format";
import { Business, emptyExpenses, QpdCalculationOut, CurrencyExpensesIn } from "@/lib/types";

function BusinessContent({ businessId }: { businessId: string }) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [calculations, setCalculations] = useState<QpdCalculationOut[]>([]);
  const [selected, setSelected] = useState<QpdCalculationOut | null>(null);
  const [error, setError] = useState("");

  // History grouping/delete state. Years start collapsed except the most
  // recent one, which is expanded the first time calculations load.
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const yearsInitialized = useRef(false);
  const [confirmingDeleteCalcId, setConfirmingDeleteCalcId] = useState<string | null>(null);
  const [deletingCalcId, setDeletingCalcId] = useState<string | null>(null);

  const [taxYear, setTaxYear] = useState(new Date().getFullYear());
  const [quarterLabel, setQuarterLabel] = useState("Annual estimate");
  const [usdSales, setUsdSales] = useState(0);
  const [zigSales, setZigSales] = useState(0);
  const [usdExpenses, setUsdExpenses] = useState<CurrencyExpensesIn>(emptyExpenses());
  const [zigExpenses, setZigExpenses] = useState<CurrencyExpensesIn>(emptyExpenses());
  const [calculating, setCalculating] = useState(false);

  // Rate overrides - default to the business's saved rates, but editable per
  // calculation since ZIMRA rates and the exchange rate both change during the year.
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [taxRatePct, setTaxRatePct] = useState<number | null>(null);
  const [aidsLevyPct, setAidsLevyPct] = useState<number | null>(null);
  const [showRateSettings, setShowRateSettings] = useState(false);

  async function loadAll() {
    try {
      const [b, calcs] = await Promise.all([
        api.getBusiness(businessId),
        api.listCalculations(businessId),
      ]);
      setBusiness(b);
      setExchangeRate(b.default_exchange_rate);
      setTaxRatePct(b.default_tax_rate * 100);
      setAidsLevyPct(b.default_aids_levy_rate * 100);
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
    // Next.js reuses this component instance when navigating between
    // businesses via the switcher (only the [businessId] param changes,
    // no remount) - reset per-business UI state explicitly or it would
    // leak across businesses.
    yearsInitialized.current = false;
    setExpandedYears(new Set());
    setConfirmingDeleteCalcId(null);
    setDeletingCalcId(null);
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

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

  function updateExpense(
    which: "usd" | "zig",
    field: keyof CurrencyExpensesIn,
    value: number
  ) {
    if (which === "usd") setUsdExpenses((prev) => ({ ...prev, [field]: value }));
    else setZigExpenses((prev) => ({ ...prev, [field]: value }));
  }

  async function onCalculate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCalculating(true);
    try {
      const result = await api.createCalculation(businessId, {
        tax_year: taxYear,
        quarter_label: quarterLabel,
        usd_sales: usdSales,
        zig_sales: zigSales,
        usd_expenses: usdExpenses,
        zig_expenses: zigExpenses,
        exchange_rate: exchangeRate,
        tax_rate: taxRatePct !== null ? taxRatePct / 100 : null,
        aids_levy_rate: aidsLevyPct !== null ? aidsLevyPct / 100 : null,
      });
      // Re-fetch rather than prepend locally: the list must stay ordered by
      // (tax_year desc, created_at desc) for the year-grouping above to
      // stay correct, and a blind prepend would break that if the user
      // calculates for an earlier tax year than what's already showing.
      const refreshed = await api.listCalculations(businessId);
      setCalculations(refreshed);
      setSelected(result);
      setExpandedYears((prev) => new Set(prev).add(result.tax_year));
    } catch {
      setError("Couldn't run that calculation. Check the figures and try again.");
    } finally {
      setCalculating(false);
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
        <div className="mx-auto max-w-5xl px-6 py-12">
          <ErrorNote>{error}</ErrorNote>
          {!error && <p className="text-sm text-ink-faint">Loading...</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-paper print:hidden">
      <TopBar />
      <div className="mx-auto max-w-5xl px-6 py-12">
        <Eyebrow>Business</Eyebrow>
        <h1 className="mt-1 font-display text-3xl text-ink">{business.name}</h1>
        <p className="mt-1 text-sm text-ink-faint">
          Default rate ZiG {business.default_exchange_rate} / USD · {(business.default_tax_rate * 100).toFixed(0)}% tax
          + {(business.default_aids_levy_rate * 100).toFixed(0)}% AIDS levy
        </p>

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="space-y-6">
            <Card>
              <Eyebrow>New QPD calculation</Eyebrow>
              <form className="mt-4 space-y-4" onSubmit={onCalculate}>
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label="Tax year"
                    type="number"
                    required
                    value={taxYear}
                    onChange={(e) => setTaxYear(parseInt(e.target.value, 10) || taxYear)}
                  />
                  <Field
                    label="Label"
                    required
                    value={quarterLabel}
                    onChange={(e) => setQuarterLabel(e.target.value)}
                    hint="e.g. 'Q3 re-estimate'"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label="USD sales"
                    type="number"
                    step="0.01"
                    min={0}
                    emptyIfZero
                    value={usdSales}
                    onChange={(e) => setUsdSales(parseFloat(e.target.value) || 0)}
                  />
                  <Field
                    label="ZiG sales"
                    type="number"
                    step="0.01"
                    min={0}
                    emptyIfZero
                    value={zigSales}
                    onChange={(e) => setZigSales(parseFloat(e.target.value) || 0)}
                  />
                </div>

                <div>
                  <p className="mb-1 text-sm font-medium text-ink-soft">Deductions</p>
                  <div className="rounded border border-line px-3">
                    <CurrencyPairInput
                      label="Cost of sales"
                      usdValue={usdExpenses.cost_of_sales}
                      zigValue={zigExpenses.cost_of_sales}
                      onUsdChange={(v) => updateExpense("usd", "cost_of_sales", v)}
                      onZigChange={(v) => updateExpense("zig", "cost_of_sales", v)}
                    />
                    <CurrencyPairInput
                      label="Salaries"
                      usdValue={usdExpenses.salaries}
                      zigValue={zigExpenses.salaries}
                      onUsdChange={(v) => updateExpense("usd", "salaries", v)}
                      onZigChange={(v) => updateExpense("zig", "salaries", v)}
                    />
                    <CurrencyPairInput
                      label="Other expenses"
                      usdValue={usdExpenses.other_expenses}
                      zigValue={zigExpenses.other_expenses}
                      onUsdChange={(v) => updateExpense("usd", "other_expenses", v)}
                      onZigChange={(v) => updateExpense("zig", "other_expenses", v)}
                    />
                    <CurrencyPairInput
                      label="Capital allowances"
                      usdValue={usdExpenses.capital_allowances}
                      zigValue={zigExpenses.capital_allowances}
                      onUsdChange={(v) => updateExpense("usd", "capital_allowances", v)}
                      onZigChange={(v) => updateExpense("zig", "capital_allowances", v)}
                    />
                  </div>
                </div>

                <div className="rounded border border-line px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setShowRateSettings((s) => !s)}
                    className="flex w-full items-center justify-between text-left text-sm font-medium text-ink-soft"
                  >
                    <span>
                      Rate settings
                      <span className="ml-2 font-mono text-xs font-normal text-ink-faint">
                        ZiG {exchangeRate ?? "-"}/USD - {taxRatePct ?? "-"}% tax + {aidsLevyPct ?? "-"}% AIDS levy
                      </span>
                    </span>
                    <span className="text-ink-faint">{showRateSettings ? "Hide" : "Edit"}</span>
                  </button>

                  {showRateSettings && (
                    <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3">
                      <Field
                        label="Exchange rate"
                        type="number"
                        step="0.01"
                        min={0}
                        hint="ZiG per USD"
                        value={exchangeRate ?? ""}
                        onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 0)}
                      />
                      <Field
                        label="Tax rate"
                        type="number"
                        step="0.01"
                        min={0}
                        max={100}
                        hint="% of taxable profit"
                        value={taxRatePct ?? ""}
                        onChange={(e) => setTaxRatePct(parseFloat(e.target.value) || 0)}
                      />
                      <Field
                        label="AIDS levy"
                        type="number"
                        step="0.01"
                        min={0}
                        max={100}
                        hint="% of tax payable"
                        value={aidsLevyPct ?? ""}
                        onChange={(e) => setAidsLevyPct(parseFloat(e.target.value) || 0)}
                      />
                      <p className="col-span-3 text-xs text-ink-faint">
                        These carry over from this business&apos;s saved defaults. Change them here for a
                        one-off recalculation (e.g. a new ZIMRA budget rate) without editing the business
                        itself.
                      </p>
                    </div>
                  )}
                </div>

                <ErrorNote>{error}</ErrorNote>
                <Button type="submit" variant="primary" disabled={calculating}>
                  {calculating ? "Calculating..." : "Calculate QPD"}
                </Button>
              </form>
            </Card>

            <Card>
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
                    <div key={group.year} className="overflow-hidden rounded border border-line">
                      <button
                        type="button"
                        onClick={() => toggleYear(group.year)}
                        aria-expanded={isExpanded}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left transition ${
                          isExpanded ? "bg-paper" : "bg-surface hover:bg-paper"
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
                                  <div className="flex items-center justify-between gap-2 rounded bg-danger-soft px-3 py-2">
                                    <span className="text-xs text-danger">
                                      Delete this calculation? This can&apos;t be undone.
                                    </span>
                                    <div className="flex shrink-0 gap-2">
                                      <button
                                        type="button"
                                        onClick={() => onDeleteCalculation(c)}
                                        disabled={deletingCalcId === c.id}
                                        className="rounded bg-danger px-2 py-1 text-xs font-semibold text-paper disabled:opacity-50"
                                      >
                                        {deletingCalcId === c.id ? "Deleting..." : "Yes, delete"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmingDeleteCalcId(null)}
                                        className="rounded border border-line px-2 py-1 text-xs text-ink-soft"
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
                                  className={`flex items-center gap-1 rounded text-sm transition ${
                                    isSelected ? "bg-usd-soft text-usd" : "text-ink-soft hover:bg-paper hover:text-ink"
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
                                    className="mr-1.5 shrink-0 rounded p-1.5 text-ink-faint/60 transition hover:bg-danger-soft hover:text-danger"
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

          <div className="space-y-6">
            {selected ? (
              <>
                <div className="flex justify-end">
                  <Button variant="secondary" type="button" onClick={() => window.print()}>
                    Download PDF summary
                  </Button>
                </div>
                <NextPaymentDue calculation={selected} />
                <ResultsPanel result={selected.result_json} taxYear={selected.tax_year} />
                <PaymentTracker calculation={selected} onSubmit={onSavePayments} />
                <TaxSummaryPrint business={business} calculation={selected} />
              </>
            ) : (
              <Card>
                <p className="text-sm text-ink-faint">
                  Run a calculation on the left to see the breakdown and schedule here.
                </p>
              </Card>
            )}
          </div>
        </div>
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
