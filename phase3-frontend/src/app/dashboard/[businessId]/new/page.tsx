"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AssetRegister } from "@/components/AssetRegister";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { CurrencyPairInput } from "@/components/CurrencyPairInput";
import { Button, Card, ErrorNote, Eyebrow, Field, Stepper } from "@/components/ui";
import { api } from "@/lib/api";
import { useBusinessData } from "@/lib/useBusinessData";
import { money } from "@/lib/format";
import { emptyExpenses, CurrencyExpensesIn } from "@/lib/types";

const STEPS = ["Period", "Income", "Deductions", "Review"];
const QUARTER_OPTIONS = [
  { value: 1, label: "QPD1 - due 25 March (10% cumulative)" },
  { value: 2, label: "QPD2 - due 25 June (35% cumulative)" },
  { value: 3, label: "QPD3 - due 25 September (65% cumulative)" },
  { value: 4, label: "QPD4 - due 20 December (100% cumulative)" },
];

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-1.5 text-sm last:border-b-0">
      <span className="text-ink-faint">{label}</span>
      <span className="font-mono tabular-nums text-ink">{value}</span>
    </div>
  );
}

function NewCalculationContent({ businessId }: { businessId: string }) {
  const router = useRouter();
  const { business, error: loadError } = useBusinessData(businessId);

  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);

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

  function goToStep(index: number) {
    if (index <= furthest) setStep(index);
  }

  function advance() {
    const nextStep = Math.min(step + 1, STEPS.length - 1);
    setStep(nextStep);
    setFurthest((f) => Math.max(f, nextStep));
  }

  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  const periodValid = quarterLabel.trim().length > 0;

  async function runCalculation() {
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

  function onFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Enter-to-submit inside any step's inputs should advance the wizard,
    // not fire the API call - only the Review step's own Calculate button
    // (the last step) actually runs the calculation.
    if (step < STEPS.length - 1) {
      if (step === 0 && !periodValid) return;
      advance();
      return;
    }
    runCalculation();
  }

  const quarterOptionLabel = QUARTER_OPTIONS.find((o) => o.value === quarter)?.label ?? "";
  const deductionRows: { label: string; usd: number; zig: number }[] = [
    { label: "Cost of sales", usd: usdExpenses.cost_of_sales, zig: zigExpenses.cost_of_sales },
    { label: "Salaries", usd: usdExpenses.salaries, zig: zigExpenses.salaries },
    { label: "Other expenses", usd: usdExpenses.other_expenses, zig: zigExpenses.other_expenses },
    { label: "Capital allowances", usd: usdExpenses.capital_allowances, zig: zigExpenses.capital_allowances },
  ];

  return (
    <main className="min-h-screen bg-paper">
      <TopBar />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Eyebrow>{business ? business.name : "Loading\u2026"}</Eyebrow>
            <h1 className="mt-0.5 font-display text-2xl text-ink sm:text-3xl">New QPD calculation</h1>
          </div>
          <Link href={`/dashboard/${businessId}`} className="shrink-0 text-sm text-ink-soft hover:text-ink">
            Cancel
          </Link>
        </div>

        <ErrorNote>{loadError}</ErrorNote>

        <div className="mt-8">
          <Stepper steps={STEPS} current={step} furthest={furthest} onStepClick={goToStep} />
        </div>

        <Card className="mt-6" letterhead>
          <form onSubmit={onFormSubmit}>
            {step === 0 && (
              <div className="space-y-4 fade-in-up">
                <Eyebrow>Period</Eyebrow>
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
                    {QUARTER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-ink-faint">
                    Which QPD you&apos;re filing for - the amount actually due nets this quarter&apos;s
                    cumulative target against what you&apos;ve confirmed paying in earlier quarters.
                  </span>
                </label>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4 fade-in-up">
                <Eyebrow>Income</Eyebrow>
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
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4 fade-in-up">
                <Eyebrow>Deductions</Eyebrow>
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
                <AssetRegister
                  businessId={businessId}
                  taxYear={taxYear}
                  onApply={(usd, zig) => {
                    updateExpense("usd", "capital_allowances", usd);
                    updateExpense("zig", "capital_allowances", zig);
                  }}
                />
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5 fade-in-up">
                <Eyebrow>Review</Eyebrow>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-sm font-medium text-ink-soft">Period</p>
                    <button type="button" onClick={() => goToStep(0)} className="text-xs text-ink-faint hover:text-ink">
                      Edit
                    </button>
                  </div>
                  <div className="rounded-md border border-line px-3">
                    <SummaryRow label="Tax year" value={String(taxYear)} />
                    <SummaryRow label="Label" value={quarterLabel} />
                    <SummaryRow label="Quarter" value={quarterOptionLabel} />
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-sm font-medium text-ink-soft">Income</p>
                    <button type="button" onClick={() => goToStep(1)} className="text-xs text-ink-faint hover:text-ink">
                      Edit
                    </button>
                  </div>
                  <div className="rounded-md border border-line px-3">
                    <SummaryRow label="USD sales" value={money(usdSales, "USD")} />
                    <SummaryRow label="ZiG sales" value={money(zigSales, "ZIG")} />
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-sm font-medium text-ink-soft">Deductions</p>
                    <button type="button" onClick={() => goToStep(2)} className="text-xs text-ink-faint hover:text-ink">
                      Edit
                    </button>
                  </div>
                  <div className="rounded-md border border-line px-3">
                    {deductionRows.map((row) => (
                      <SummaryRow
                        key={row.label}
                        label={row.label}
                        value={`${money(row.usd, "USD")} / ${money(row.zig, "ZIG")}`}
                      />
                    ))}
                  </div>
                </div>

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
                        {taxRatePct !== null ? taxRatePct.toFixed(0) : "\u2026"}% tax +{" "}
                        {aidsLevyPct !== null ? aidsLevyPct.toFixed(0) : "\u2026"}% AIDS levy
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
              </div>
            )}

            <div className="mt-6 flex items-center justify-between border-t border-line pt-5">
              <button
                type="button"
                onClick={back}
                disabled={step === 0}
                className="text-sm text-ink-soft hover:text-ink disabled:opacity-0"
              >
                Back
              </button>
              {step < STEPS.length - 1 ? (
                <Button type="submit" variant="primary" disabled={step === 0 && !periodValid}>
                  Continue
                </Button>
              ) : (
                <Button type="submit" variant="primary" disabled={calculating}>
                  {calculating ? "Calculating\u2026" : "Calculate QPD"}
                </Button>
              )}
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
