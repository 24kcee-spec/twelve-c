"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AssetRegister } from "@/components/AssetRegister";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { CurrencyPairInput } from "@/components/CurrencyPairInput";
import { Button, Card, ErrorNote, Eyebrow, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { useBusinessData } from "@/lib/useBusinessData";
import { emptyExpenses, CurrencyExpensesIn } from "@/lib/types";

function NewCalculationContent({ businessId }: { businessId: string }) {
  const router = useRouter();
  const { business, error: loadError } = useBusinessData(businessId);

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
  const [error, setError] = useState("");

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
  const [ratesInitialized, setRatesInitialized] = useState(false);

  // Business defaults arrive asynchronously - seed the rate override fields
  // from them exactly once, the first time they're available, without
  // fighting any edit the person has already made to those fields.
  useEffect(() => {
    if (business && !ratesInitialized) {
      setExchangeRate(business.default_exchange_rate);
      setTaxRatePct(business.default_tax_rate * 100);
      setAidsLevyPct(business.default_aids_levy_rate * 100);
      setRatesInitialized(true);
    }
  }, [business, ratesInitialized]);

  function updateExpense(which: "usd" | "zig", field: keyof CurrencyExpensesIn, value: number) {
    if (which === "usd") setUsdExpenses((prev) => ({ ...prev, [field]: value }));
    else setZigExpenses((prev) => ({ ...prev, [field]: value }));
  }

  async function onCalculate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCalculating(true);
    try {
      await api.createCalculation(businessId, {
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
      // Overview re-fetches on mount, so the new calculation (most recent
      // by created_at) is already there and selected by the time it lands.
      router.push(`/dashboard/${businessId}`);
    } catch {
      setError("Couldn't run that calculation. Check the figures and try again.");
      setCalculating(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper">
      <TopBar />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Eyebrow>{business ? business.name : "Loading…"}</Eyebrow>
            <h1 className="mt-0.5 font-display text-2xl text-ink sm:text-3xl">New QPD calculation</h1>
          </div>
          <Link href={`/dashboard/${businessId}`} className="shrink-0 text-sm text-ink-soft hover:text-ink">
            Cancel
          </Link>
        </div>

        <ErrorNote>{loadError}</ErrorNote>

        <Card className="mt-6" letterhead>
          <form className="space-y-4" onSubmit={onCalculate}>
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
              <span className="mb-1 block text-sm font-medium text-ink-soft">QPD quarter</span>
              <select
                value={quarter}
                onChange={(e) => setQuarter(parseInt(e.target.value, 10))}
                className="w-full rounded border border-line bg-surface px-3 py-2.5 font-mono text-sm text-ink outline-none transition duration-150 ease-snap focus:border-seal"
              >
                <option value={1}>QPD1 - due 25 March (10% cumulative)</option>
                <option value={2}>QPD2 - due 25 June (35% cumulative)</option>
                <option value={3}>QPD3 - due 25 September (65% cumulative)</option>
                <option value={4}>QPD4 - due 20 December (100% cumulative)</option>
              </select>
              <span className="mt-1 block text-xs text-ink-faint">
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

            <div className="rounded-md border border-line p-3">
              <button
                type="button"
                onClick={() => setShowRateSettings((s) => !s)}
                className="flex w-full items-center justify-between text-left text-sm"
              >
                <span>
                  <span className="font-medium text-ink">Rate settings</span>
                  <span className="ml-2 text-ink-faint">
                    ZiG {exchangeRate ?? "…"}/USD ·{" "}
                    {taxRatePct !== null ? taxRatePct.toFixed(0) : "…"}% tax +{" "}
                    {aidsLevyPct !== null ? aidsLevyPct.toFixed(0) : "…"}% AIDS levy
                  </span>
                </span>
                <span className="text-ink-soft">{showRateSettings ? "Hide" : "Edit"}</span>
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

            <div className="rounded-md border border-line p-3">
              <button
                type="button"
                onClick={() => setShowAdjustments((v) => !v)}
                className="flex w-full items-center justify-between text-left text-sm"
              >
                <span className="font-medium text-ink">Adjustments</span>
                <span className="text-ink-soft">{showAdjustments ? "Hide" : "Edit"}</span>
              </button>
              {showAdjustments && (
                <div className="mt-3 space-y-3 border-t border-line pt-3">
                  <p className="text-xs text-ink-faint">Optional. Leave at 0 if these don&apos;t apply.</p>
                  <CurrencyPairInput
                    label="Assessed loss b/f"
                    usdValue={assessedLossUsd}
                    zigValue={assessedLossZig}
                    onUsdChange={setAssessedLossUsd}
                    onZigChange={setAssessedLossZig}
                  />
                  <CurrencyPairInput
                    label="Withholding credits"
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
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" disabled={calculating} className="w-full sm:w-auto">
                {calculating ? "Calculating…" : "Calculate QPD"}
              </Button>
              <Link href={`/dashboard/${businessId}`} className="text-sm text-ink-soft hover:text-ink">
                Cancel
              </Link>
            </div>
          </form>
        </Card>
      </div>
    </main>
  );
}

export default function NewCalculationPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = params.businessId;

  return (
    <AuthGuard>
      <NewCalculationContent businessId={businessId} />
    </AuthGuard>
  );
}
