"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AssetRegister } from "@/components/AssetRegister";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { CurrencyPairInput } from "@/components/CurrencyPairInput";
import { ResultsPanel } from "@/components/ResultsPanel";
import { PaymentTracker } from "@/components/PaymentTracker";
import { NextPaymentDue } from "@/components/NextPaymentDue";
import { downloadTaxSummaryPdf } from "@/lib/generatePdf";
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
  // Which QPD this run is FOR (1=25 Mar, 2=25 Jun, 3=25 Sep, 4=20 Dec) -
  // drives the engine's cumulative net_payable, not just the schedule
  // projection. Must be sent on every create - the backend defaults to 1
  // when omitted, which silently mis-files anything past Q1 if this isn't wired up.
  const [quarter, setQuarter] = useState(1);
  const [usdSales, setUsdSales] = useState(0);
  const [zigSales, setZigSales] = useState(0);
  const [usdExpenses, setUsdExpenses] = useState<CurrencyExpensesIn>(emptyExpenses());
  const [zigExpenses, setZigExpenses] = useState<CurrencyExpensesIn>(emptyExpenses());
  const [calculating, setCalculating] = useState(false);

  // Optional annual adjustments - assessed loss b/f reduces the taxable
  // base; withholding credits net off the cumulative amount due. Both
  // default to 0, which reproduces identical results to before these existed.
  const [showAdjustments, setShowAdjustments] = useState(false);
  const [assessedLossUsd, setAssessedLossUsd] = useState(0);
  const [assessedLossZig, setAssessedLossZig] = useState(0);
  const [withholdingCreditsUsd, setWithholdingCreditsUsd] = useState(0);
  const [withholdingCreditsZig, setWithholdingCreditsZig] = useState(0);

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
        quarter,
        usd_sales: usdSales,
        zig_sales: zigSales,
        usd_expenses: usdExpenses,
        zig_expenses: zigExpenses,
        exchange_rate: exchangeRate,
        tax_rate: taxRatePct !== null ? taxRatePct / 100 : null,
        aids_levy_rate: aidsLevyPct !== null ? aidsLevyPct / 100 : null,
        assessed_loss_usd: assessedLossUsd,
        assessed_loss_zig: assessedLossZig,
        withholding_credits_usd: withholdingCreditsUsd,
        withholding_credits_zig: withholdingCreditsZig,
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
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
          <ErrorNote>{error}</ErrorNote>
          {!error && (
            <div className="space-y-4">
              <div className="glass h-32 animate-pulse rounded-lg" />
              <div className="glass h-64 animate-pulse rounded-lg" />
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-paper">
      <TopBar />
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-signal-gradient font-mono text-base font-semibold text-paper shadow-glow-sm">
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
        <p className="mt-2 font-mono text-xs text-ink-faint sm:text-sm">
          ZiG {business.default_exchange_rate} / USD · {(business.default_tax_rate * 100).toFixed(0)}% tax
          + {(business.default_aids_levy_rate * 100).toFixed(0)}% AIDS levy
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
          <div className="space-y-6">
            <Card>
              <Eyebrow>New QPD calculation</Eyebrow>
              <form className="mt-4 space-y-4" onSubmit={onCalculate}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-ink-soft">QPD quarter</span>
                  <select
                    value={quarter}
                    onChange={(e) => setQuarter(parseInt(e.target.value, 10))}
                    className="w-full rounded-md border border-line bg-surface/60 px-3 py-2.5 font-mono text-sm text-ink outline-none backdrop-blur-sm transition duration-150 ease-snap focus:border-usd focus:shadow-glow-sm"
                  >
                    <option value={1}>QPD1 - due 25 March (10% cumulative)</option>
                    <option value={2}>QPD2 - due 25 June (35% cumulative)</option>
                    <option value={3}>QPD3 - due 25 September (65% cumulative)</option>
                    <option value={4}>QPD4 - due 20 December (100% cumulative)</option>
                  </select>
                  <span className="mt-1.5 block text-xs text-ink-faint">
                    Which QPD you&apos;re filing for - the amount actually due nets this quarter&apos;s
                    cumulative target against what you&apos;ve confirmed paying in earlier quarters.
                  </span>
                </label>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  <div className="rounded-md border border-line bg-paper/30 px-3">
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

                <AssetRegister
                  businessId={businessId}
                  taxYear={taxYear}
                  onApply={(usd, zig) => {
                    updateExpense("usd", "capital_allowances", usd);
                    updateExpense("zig", "capital_allowances", zig);
                  }}
                />

                <div className="rounded-md border border-line bg-paper/30 px-3 py-2 transition duration-150 hover:border-usd/40">
                  <button
                    type="button"
                    onClick={() => setShowRateSettings((s) => !s)}
                    className="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-ink-soft"
                  >
                    <span className="min-w-0">
                      Rate settings
                      <span className="ml-2 block font-mono text-xs font-normal text-ink-faint sm:inline sm:truncate">
                        ZiG {exchangeRate ?? "-"}/USD - {taxRatePct ?? "-"}% tax + {aidsLevyPct ?? "-"}% AIDS levy
                      </span>
                    </span>
                    <span className="shrink-0 text-usd">{showRateSettings ? "Hide" : "Edit"}</span>
                  </button>

                  {showRateSettings && (
                    <div className="mt-3 grid grid-cols-1 gap-3 border-t border-line pt-3 sm:grid-cols-3">
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
                      <p className="col-span-1 text-xs text-ink-faint sm:col-span-3">
                        These carry over from this business&apos;s saved defaults. Change them here for a
                        one-off recalculation (e.g. a new ZIMRA budget rate) without editing the business
                        itself.
                      </p>
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-line bg-paper/30 px-3 py-2 transition duration-150 hover:border-usd/40">
                  <button
                    type="button"
                    onClick={() => setShowAdjustments((s) => !s)}
                    className="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-ink-soft"
                  >
                    <span>
                      Adjustments
                      {(assessedLossUsd > 0 || assessedLossZig > 0 || withholdingCreditsUsd > 0 || withholdingCreditsZig > 0) && (
                        <span className="ml-2 font-mono text-xs font-normal text-usd">active</span>
                      )}
                    </span>
                    <span className="shrink-0 text-usd">{showAdjustments ? "Hide" : "Edit"}</span>
                  </button>

                  {showAdjustments && (
                    <div className="mt-3 space-y-1 border-t border-line pt-3">
                      <CurrencyPairInput
                        label="Assessed loss b/f"
                        usdValue={assessedLossUsd}
                        zigValue={assessedLossZig}
                        onUsdChange={setAssessedLossUsd}
                        onZigChange={setAssessedLossZig}
                      />
                      <CurrencyPairInput
                        label="Withholding tax credits"
                        usdValue={withholdingCreditsUsd}
                        zigValue={withholdingCreditsZig}
                        onUsdChange={setWithholdingCreditsUsd}
                        onZigChange={setWithholdingCreditsZig}
                      />
                      <p className="pt-2 text-xs text-ink-faint">
                        Assessed loss reduces the taxable base before tax is computed. Withholding
                        credits (e.g. 30% withheld by a client for lack of an ITF263 clearance) are
                        netted off the amount still due this quarter, same as a confirmed payment.
                      </p>
                    </div>
                  )}
                </div>

                <ErrorNote>{error}</ErrorNote>
                <Button type="submit" variant="primary" disabled={calculating} className="w-full sm:w-auto">
                  {calculating ? "Calculating…" : "Calculate QPD"}
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
                                    isSelected ? "bg-usd-soft text-usd shadow-glow-sm" : "text-ink-soft hover:bg-paper/60 hover:text-ink"
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

          <div className="space-y-6">
            {selected ? (
              <>
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => downloadTaxSummaryPdf(business, selected)}
                    className="w-full sm:w-auto"
                  >
                    Download PDF summary
                  </Button>
                </div>
                <NextPaymentDue calculation={selected} />
                <ResultsPanel result={selected.result_json} taxYear={selected.tax_year} />
                <PaymentTracker key={selected.id} calculation={selected} onSubmit={onSavePayments} />
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