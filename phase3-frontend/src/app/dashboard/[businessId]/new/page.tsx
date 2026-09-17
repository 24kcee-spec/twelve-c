"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AssetRegister } from "@/components/AssetRegister";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { CurrencyPairInput } from "@/components/CurrencyPairInput";
import { MonthlyIncomeCalculator } from "@/components/MonthlyIncomeCalculator";
import { Button, Card, ErrorNote, Eyebrow, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { useBusinessData } from "@/lib/useBusinessData";
import { formatDateTime, money } from "@/lib/format";
import { emptyExpenses, ApiError, CurrencyExpensesIn, QpdCalculationOut } from "@/lib/types";

// This used to be a 4-step wizard gated behind "Next" buttons. It's now one
// continuous page, sectioned like an income statement (Period, Income,
// Deductions, Rate settings, Adjustments, then a running total and the
// submit button) so nothing is hidden behind a click - just scroll.
const QUARTER_OPTIONS = [
  { value: 1, label: "QPD1 - due 25 March (10% cumulative)" },
  { value: 2, label: "QPD2 - due 25 June (35% cumulative)" },
  { value: 3, label: "QPD3 - due 25 September (65% cumulative)" },
  { value: 4, label: "QPD4 - due 20 December (100% cumulative)" },
];

function SectionCard({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <Card letterhead>
      <Eyebrow>{eyebrow}</Eyebrow>
      <div className="mt-4 space-y-4">{children}</div>
    </Card>
  );
}

function NewCalculationContent({ businessId }: { businessId: string }) {
  const router = useRouter();
  const { business, error: loadError } = useBusinessData(businessId);

  // A quarter card on the Overview tab can deep-link straight into a
  // specific tax year/quarter ("+ Calculate" on an uncalculated quarter)
  // via ?taxYear=&quarter= - when present, that explicit choice wins over
  // the "first uncalculated quarter" smart default below.
  const searchParams = useSearchParams();
  const paramTaxYear = useMemo(() => {
    const n = parseInt(searchParams.get("taxYear") ?? "", 10);
    return Number.isFinite(n) ? n : null;
  }, [searchParams]);
  const paramQuarter = useMemo(() => {
    const n = parseInt(searchParams.get("quarter") ?? "", 10);
    return n >= 1 && n <= 4 ? n : null;
  }, [searchParams]);

  const [taxYear, setTaxYear] = useState(paramTaxYear ?? new Date().getFullYear());
  // Free-text note only - NOT a calculation-type selector. Previously
  // defaulted to the words "Annual estimate" while the hint below it said
  // "e.g. Q3 re-estimate", which read as two conflicting instructions.
  // It's just an optional label for this run, nothing more.
  const [quarterLabel, setQuarterLabel] = useState("");
  const [quarter, setQuarter] = useState(paramQuarter ?? 1);
  const [usdSales, setUsdSales] = useState(0);
  const [zigSales, setZigSales] = useState(0);
  const [usdExpenses, setUsdExpenses] = useState<CurrencyExpensesIn>(emptyExpenses());
  const [zigExpenses, setZigExpenses] = useState<CurrencyExpensesIn>(emptyExpenses());
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState("");

  const [showAdjustments, setShowAdjustments] = useState(false);
  const [assessedLossUsd, setAssessedLossUsd] = useState(0);
  const [assessedLossZig, setAssessedLossZig] = useState(0);
  const [withholdingCreditsUsd, setWithholdingCreditsUsd] = useState(0);
  const [withholdingCreditsZig, setWithholdingCreditsZig] = useState(0);

  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [taxRatePct, setTaxRatePct] = useState<number | null>(null);
  const [aidsLevyPct, setAidsLevyPct] = useState<number | null>(null);
  const [showRateSettings, setShowRateSettings] = useState(false);
  const [ratesInitialized, setRatesInitialized] = useState(false);

  // Existing calculations for this business - used to (a) prefill
  // deductions/adjustments from the most recent run, since those have no
  // other persistence (unlike sales, which the monthly calculator above
  // already carries forward on its own), and (b) block resubmitting a
  // quarter that's already been calculated until it's deleted.
  const [calculations, setCalculations] = useState<QpdCalculationOut[] | null>(null);
  const [calcsError, setCalcsError] = useState("");
  const [inputsInitialized, setInputsInitialized] = useState(false);
  const [quarterInitialized, setQuarterInitialized] = useState(paramQuarter !== null);
  const [deletingDuplicate, setDeletingDuplicate] = useState(false);

  useEffect(() => {
    if (business && !ratesInitialized) {
      setExchangeRate(business.default_exchange_rate);
      setTaxRatePct(business.default_tax_rate * 100);
      setAidsLevyPct(business.default_aids_levy_rate * 100);
      setRatesInitialized(true);
    }
  }, [business, ratesInitialized]);

  useEffect(() => {
    let cancelled = false;
    api
      .listCalculations(businessId)
      .then((data) => {
        if (!cancelled) setCalculations(data);
      })
      .catch(() => {
        if (!cancelled) {
          setCalculations([]);
          setCalcsError("Couldn't check for existing calculations - proceed carefully.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  // Prefill deductions and adjustments from the most recent calculation
  // (any quarter) once the list has loaded - runs once, so it doesn't
  // fight with the person's own edits afterward.
  useEffect(() => {
    if (calculations && calculations.length > 0 && !inputsInitialized) {
      const latest = calculations[0].input_json;
      setUsdExpenses(latest.usd_expenses);
      setZigExpenses(latest.zig_expenses);
      setAssessedLossUsd(latest.assessed_loss_usd);
      setAssessedLossZig(latest.assessed_loss_zig);
      setWithholdingCreditsUsd(latest.withholding_credits_usd);
      setWithholdingCreditsZig(latest.withholding_credits_zig);
      if (
        latest.assessed_loss_usd ||
        latest.assessed_loss_zig ||
        latest.withholding_credits_usd ||
        latest.withholding_credits_zig
      ) {
        setShowAdjustments(true);
      }
      setInputsInitialized(true);
    }
  }, [calculations, inputsInitialized]);

  // Default to the first quarter this tax year that hasn't been
  // calculated yet, instead of always starting on QPD1.
  useEffect(() => {
    if (calculations && !quarterInitialized) {
      const usedQuarters = new Set(
        calculations.filter((c) => c.tax_year === taxYear).map((c) => c.quarter)
      );
      const nextQuarter = [1, 2, 3, 4].find((q) => !usedQuarters.has(q));
      if (nextQuarter) setQuarter(nextQuarter);
      setQuarterInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculations, quarterInitialized]);

  // A calculation already exists for the currently-selected tax year +
  // quarter - block resubmitting until it's deleted, rather than silently
  // adding a second entry for the same quarter.
  const duplicateCalc = useMemo(() => {
    if (!calculations) return null;
    return calculations.find((c) => c.tax_year === taxYear && c.quarter === quarter) ?? null;
  }, [calculations, taxYear, quarter]);

  async function deleteDuplicate() {
    if (!duplicateCalc) return;
    setDeletingDuplicate(true);
    setError("");
    try {
      await api.deleteCalculation(businessId, duplicateCalc.id);
      setCalculations((prev) => prev?.filter((c) => c.id !== duplicateCalc.id) ?? null);
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === "string"
          ? err.detail
          : "Couldn't delete that calculation. Try again in a moment."
      );
    } finally {
      setDeletingDuplicate(false);
    }
  }

  function updateExpense(which: "usd" | "zig", field: keyof CurrencyExpensesIn, value: number) {
    if (which === "usd") setUsdExpenses((prev) => ({ ...prev, [field]: value }));
    else setZigExpenses((prev) => ({ ...prev, [field]: value }));
  }

  const totalDeductionsUsd =
    usdExpenses.cost_of_sales + usdExpenses.salaries + usdExpenses.other_expenses + usdExpenses.capital_allowances;
  const totalDeductionsZig =
    zigExpenses.cost_of_sales + zigExpenses.salaries + zigExpenses.other_expenses + zigExpenses.capital_allowances;

  const canSubmit =
    Number.isFinite(taxYear) && taxYear >= 2000 && taxYear <= 2100 && !duplicateCalc;

  async function runCalculation(e: React.FormEvent) {
    e.preventDefault();
    if (duplicateCalc) {
      setError("Delete the existing calculation for this quarter before recalculating.");
      return;
    }
    if (!canSubmit) {
      setError("Enter a valid tax year.");
      return;
    }
    setError("");
    setCalculating(true);
    try {
      await api.createCalculation(businessId, {
        tax_year: taxYear,
        quarter_label: quarterLabel.trim() || QUARTER_OPTIONS[quarter - 1].label.split(" - ")[0],
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
            <Eyebrow>{business ? business.name : "Loading\u2026"}</Eyebrow>
            <h1 className="mt-0.5 font-display text-2xl text-ink sm:text-3xl">New QPD calculation</h1>
          </div>
          <Link href={`/dashboard/${businessId}`} className="shrink-0 text-sm text-ink-soft hover:text-ink">
            Cancel
          </Link>
        </div>

        <ErrorNote>{loadError}</ErrorNote>

        <form onSubmit={runCalculation} className="mt-8 space-y-5">
          <SectionCard eyebrow="Period">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Tax year"
                type="number"
                required
                value={taxYear}
                onChange={(e) => setTaxYear(parseInt(e.target.value, 10) || taxYear)}
              />
              <Field
                label="Note (optional)"
                value={quarterLabel}
                onChange={(e) => setQuarterLabel(e.target.value)}
                placeholder="e.g. 'Revised after August sales'"
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

            {duplicateCalc && (
              <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-3 text-sm">
                <p className="text-danger">
                  {duplicateCalc.quarter_label} for {taxYear} was already calculated on{" "}
                  {formatDateTime(duplicateCalc.created_at)} -{" "}
                  {money(duplicateCalc.result_json.total_tax_usd, "USD")} /{" "}
                  {money(duplicateCalc.result_json.total_tax_zig, "ZIG")}. Delete it to
                  recalculate this quarter.
                </p>
                <button
                  type="button"
                  onClick={deleteDuplicate}
                  disabled={deletingDuplicate}
                  className="mt-2 rounded-md bg-danger px-3 py-1.5 text-xs font-semibold text-paper transition disabled:opacity-50"
                >
                  {deletingDuplicate ? "Deleting\u2026" : "Delete existing calculation"}
                </button>
              </div>
            )}

            {calcsError && <p className="text-xs text-danger">{calcsError}</p>}
          </SectionCard>

          <SectionCard eyebrow="Income">
            <MonthlyIncomeCalculator
              businessId={businessId}
              taxYear={taxYear}
              quarter={quarter}
              onUsdChange={setUsdSales}
              onZigChange={setZigSales}
            />
            <div className="grid grid-cols-1 gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <Field
                label="USD sales (annualized)"
                type="number"
                step="0.01"
                min={0}
                emptyIfZero
                value={usdSales}
                onChange={(e) => setUsdSales(parseFloat(e.target.value) || 0)}
              />
              <Field
                label="ZiG sales (annualized)"
                type="number"
                step="0.01"
                min={0}
                emptyIfZero
                value={zigSales}
                onChange={(e) => setZigSales(parseFloat(e.target.value) || 0)}
              />
            </div>
            <p className="text-xs text-ink-faint">
              These two fields are what actually gets sent to the calculation - filled in
              automatically from the monthly breakdown above, or type directly in manual mode.
            </p>
          </SectionCard>

          <SectionCard eyebrow="Deductions">
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
          </SectionCard>

          <SectionCard eyebrow="Rate settings">
            <button
              type="button"
              onClick={() => setShowRateSettings((s) => !s)}
              className="flex w-full items-center justify-between text-left text-sm"
            >
              <span className="text-ink-faint">
                ZiG {exchangeRate ?? "\u2026"}/USD &middot;{" "}
                {taxRatePct !== null ? taxRatePct.toFixed(0) : "\u2026"}% tax +{" "}
                {aidsLevyPct !== null ? aidsLevyPct.toFixed(0) : "\u2026"}% AIDS levy
              </span>
              <span className="text-usd">{showRateSettings ? "Hide" : "Edit"}</span>
            </button>
            {showRateSettings && (
              <div className="grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-3">
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
          </SectionCard>

          <SectionCard eyebrow="Adjustments">
            <button
              type="button"
              onClick={() => setShowAdjustments((v) => !v)}
              className="flex w-full items-center justify-between text-left text-sm"
            >
              <span className="text-ink-faint">Assessed loss b/f &middot; withholding credits</span>
              <span className="text-usd">{showAdjustments ? "Hide" : "Edit"}</span>
            </button>
            {showAdjustments && (
              <div className="space-y-3 border-t border-line pt-4">
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
          </SectionCard>

          <Card className="border-seal/40">
            <div className="flex items-center justify-between border-b border-line pb-3 text-sm">
              <span className="text-ink-soft">Sales entered</span>
              <span className="font-mono tabular-nums text-ink">
                {money(usdSales, "USD")} / {money(zigSales, "ZIG")}
              </span>
            </div>
            <div className="flex items-center justify-between pt-3 text-sm">
              <span className="text-ink-soft">Deductions entered</span>
              <span className="font-mono tabular-nums text-ink">
                {money(totalDeductionsUsd, "USD")} / {money(totalDeductionsZig, "ZIG")}
              </span>
            </div>
          </Card>

          <ErrorNote>{error}</ErrorNote>

          <div className="flex items-center justify-end gap-3 pt-1">
            <Button type="submit" variant="primary" disabled={calculating || !canSubmit}>
              {calculating ? "Calculating\u2026" : "Calculate QPD"}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function NewCalculationPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = params.businessId;

  return (
    <AuthGuard>
      <Suspense fallback={null}>
        <NewCalculationContent businessId={businessId} />
      </Suspense>
    </AuthGuard>
  );
}