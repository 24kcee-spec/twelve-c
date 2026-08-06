"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { CurrencyPairInput } from "@/components/CurrencyPairInput";
import { ResultsPanel } from "@/components/ResultsPanel";
import { PaymentTracker } from "@/components/PaymentTracker";
import { NextPaymentDue } from "@/components/NextPaymentDue";
import { TaxSummaryPrint } from "@/components/TaxSummaryPrint";
import { Button, Card, ErrorNote, Eyebrow, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { Business, emptyExpenses, QpdCalculationOut, CurrencyExpensesIn } from "@/lib/types";

function BusinessContent({ businessId }: { businessId: string }) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [calculations, setCalculations] = useState<QpdCalculationOut[]>([]);
  const [selected, setSelected] = useState<QpdCalculationOut | null>(null);
  const [error, setError] = useState("");

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
    } catch {
      setError("Couldn't load this business.");
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

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
      setCalculations((prev) => [result, ...prev]);
      setSelected(result);
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
              <Eyebrow>History</Eyebrow>
              {calculations.length === 0 && (
                <p className="mt-2 text-sm text-ink-faint">No calculations yet.</p>
              )}
              <ul className="mt-3 space-y-1">
                {calculations.map((c, idx) => {
                  const isSelected = selected?.id === c.id;
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelected(c)}
                        className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm transition ${
                          isSelected
                            ? "bg-usd-soft text-usd"
                            : "text-ink-soft hover:bg-paper hover:text-ink"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          {c.tax_year} · {c.quarter_label}
                          {idx === 0 && (
                            <span className="rounded-full bg-ink px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-paper">
                              Latest
                            </span>
                          )}
                          {isSelected && (
                            <span className="rounded-full border border-usd px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-usd">
                              Viewing
                            </span>
                          )}
                        </span>
                        <span className="font-mono tabular-nums">
                          {money(c.result_json.total_tax_usd, "USD")}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
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
