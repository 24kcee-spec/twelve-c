"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { downloadTaxSummaryPdf } from "@/lib/generatePdf";
import { money, percent, formatDateTime } from "@/lib/format";
import { calculateStudyQpd, readStudyEngineManifest, StudyEngineManifest } from "@/lib/studyEngine";
import {
  clearStudyState,
  createLocalId,
  EMPTY_STUDY_STATE,
  readStudyState,
  StudyCalculation,
  StudyState,
  sumConfirmedPriorPayments,
  writeStudyState,
} from "@/lib/studyStorage";
import { downloadStudyWorkbook } from "@/lib/studyExcel";
import {
  Business,
  CurrencyExpensesIn,
  emptyExpenses,
  QpdCalculationCreate,
  QpdResultJson,
} from "@/lib/types";

const TAX_YEAR = 2026;
const STUDY_EXCHANGE_RATE = Number(
  process.env.NEXT_PUBLIC_STUDY_EXCHANGE_RATE || "26.8"
);
const CORPORATE_TAX_RATE = 0.25;
const AIDS_LEVY_RATE = 0.03;

const QUARTERS = [
  { value: 1, label: "QPD1", date: "25 March", cumulative: "10%" },
  { value: 2, label: "QPD2", date: "25 June", cumulative: "35%" },
  { value: 3, label: "QPD3", date: "25 September", cumulative: "65%" },
  { value: 4, label: "QPD4", date: "20 December", cumulative: "100%" },
];

const EMPTY_EXPENSES = emptyExpenses();

function validAmount(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function NumberField({
  label,
  value,
  onChange,
  step = "0.01",
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink-soft">{label}</span>
      <input
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value === "" ? 0 : Number(event.currentTarget.value))}
        className="mt-1.5 w-full rounded-md border border-line bg-paper px-3 py-2.5 font-mono text-sm text-ink outline-none transition focus:border-seal"
      />
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

function ExpenseFields({
  title,
  values,
  onChange,
}: {
  title: string;
  values: CurrencyExpensesIn;
  onChange: (field: keyof CurrencyExpensesIn, value: number) => void;
}) {
  const fields: { key: keyof CurrencyExpensesIn; label: string }[] = [
    { key: "cost_of_sales", label: "Cost of sales" },
    { key: "salaries", label: "Salaries" },
    { key: "other_expenses", label: "Other expenses" },
    { key: "capital_allowances", label: "Capital allowances" },
  ];
  return (
    <div className="rounded-md border border-line bg-paper/50 p-4">
      <h3 className="font-display text-base text-ink">{title}</h3>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <NumberField
            key={field.key}
            label={field.label}
            value={values[field.key]}
            onChange={(value) => onChange(field.key, value)}
          />
        ))}
      </div>
    </div>
  );
}

function SectionCard({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-card sm:p-6">
      {eyebrow && (
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
          {eyebrow}
        </p>
      )}
      <h2 className="mt-1 font-display text-xl text-ink">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export default function StudyPage() {
  const [state, setState] = useState<StudyState>(EMPTY_STUDY_STATE);
  const [ready, setReady] = useState(false);
  const [manifest, setManifest] = useState<StudyEngineManifest | null>(null);
  const [businessName, setBusinessName] = useState("Khami Timber Enterprises (Pvt) Ltd");
  const [quarter, setQuarter] = useState(1);
  const [quarterLabel, setQuarterLabel] = useState("");
  const [usdSales, setUsdSales] = useState(0);
  const [zigSales, setZigSales] = useState(0);
  const [usdExpenses, setUsdExpenses] = useState<CurrencyExpensesIn>(EMPTY_EXPENSES);
  const [zigExpenses, setZigExpenses] = useState<CurrencyExpensesIn>(EMPTY_EXPENSES);
  const [assessedLossUsd, setAssessedLossUsd] = useState(0);
  const [assessedLossZig, setAssessedLossZig] = useState(0);
  const [withholdingUsd, setWithholdingUsd] = useState(0);
  const [withholdingZig, setWithholdingZig] = useState(0);
  const [calculating, setCalculating] = useState(false);
  const [engineLoading, setEngineLoading] = useState(false);
  const [error, setError] = useState("");
  const [storeError, setStoreError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paymentFor, setPaymentFor] = useState<string | null>(null);
  const [paymentUsd, setPaymentUsd] = useState(0);
  const [paymentZig, setPaymentZig] = useState(0);
  const [paymentError, setPaymentError] = useState("");
  const skipNextSave = useRef(false);

  useEffect(() => {
    setState(readStudyState());
    setReady(true);
    readStudyEngineManifest().then(setManifest).catch(() => setManifest(null));
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    try {
      writeStudyState(state);
      setStoreError("");
    } catch (saveError) {
      setStoreError(
        saveError instanceof Error ? saveError.message : "Browser storage is unavailable."
      );
    }
  }, [ready, state]);

  const business = state.business;
  const calculations = state.calculations;
  const selectedCalculation = useMemo(
    () => calculations.find((item) => item.id === selectedId) ?? calculations[0] ?? null,
    [calculations, selectedId]
  );

  const priorPayments = useMemo(
    () => sumConfirmedPriorPayments(calculations, TAX_YEAR, quarter),
    [calculations, quarter]
  );

  const fixedRateAvailable =
    Number.isFinite(STUDY_EXCHANGE_RATE) && STUDY_EXCHANGE_RATE > 0;

  function createBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!businessName.trim()) {
      setError("Enter the fictional business name to continue.");
      return;
    }
    if (!fixedRateAvailable) {
      setError("The study exchange rate is not configured. Set NEXT_PUBLIC_STUDY_EXCHANGE_RATE and rebuild the app.");
      return;
    }
    const now = new Date().toISOString();
    const created: Business = {
      id: createLocalId("study-business"),
      name: businessName.trim(),
      default_exchange_rate: STUDY_EXCHANGE_RATE,
      default_tax_rate: CORPORATE_TAX_RATE,
      default_aids_levy_rate: AIDS_LEVY_RATE,
      created_at: now,
      updated_at: now,
    };
    setState((current) => ({ ...current, business: created }));
  }

  function changeExpense(
    currency: "USD" | "ZiG",
    field: keyof CurrencyExpensesIn,
    value: number
  ) {
    if (currency === "USD") {
      setUsdExpenses((current) => ({ ...current, [field]: value }));
    } else {
      setZigExpenses((current) => ({ ...current, [field]: value }));
    }
  }

  async function runCalculation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!business) {
      setError("Create the fictional business profile first.");
      return;
    }
    if (!fixedRateAvailable) {
      setError("The study exchange rate is not configured. Contact the researcher.");
      return;
    }
    if (
      ![
        usdSales,
        zigSales,
        ...Object.values(usdExpenses),
        ...Object.values(zigExpenses),
        assessedLossUsd,
        assessedLossZig,
        withholdingUsd,
        withholdingZig,
      ].every(validAmount)
    ) {
      setError("Enter valid non-negative amounts in every field.");
      return;
    }
    const existing = calculations.find(
      (item) => item.tax_year === TAX_YEAR && item.quarter === quarter
    );
    if (existing) {
      setError(
        \`A \${QUARTERS[quarter - 1].label} calculation already exists. Delete that run in the history below before repeating this quarter.\`
      );
      setSelectedId(existing.id);
      return;
    }

    setCalculating(true);
    setEngineLoading(true);
    setError("");
    try {
      const previous = sumConfirmedPriorPayments(calculations, TAX_YEAR, quarter);
      const engineInput = {
        tax_year: TAX_YEAR,
        quarter,
        usd_sales: usdSales,
        zig_sales: zigSales,
        usd_expenses: { ...usdExpenses },
        zig_expenses: { ...zigExpenses },
        exchange_rate: STUDY_EXCHANGE_RATE,
        tax_rate: CORPORATE_TAX_RATE,
        aids_levy_rate: AIDS_LEVY_RATE,
        previous_qpds_paid_usd: previous.usd,
        previous_qpds_paid_zig: previous.zig,
        assessed_loss_usd: assessedLossUsd,
        assessed_loss_zig: assessedLossZig,
        withholding_credits_usd: withholdingUsd,
        withholding_credits_zig: withholdingZig,
      };

      const result: QpdResultJson = await calculateStudyQpd(engineInput);
      const now = new Date().toISOString();
      const inputJson: QpdCalculationCreate = {
        tax_year: TAX_YEAR,
        quarter_label: quarterLabel.trim() || \`\${QUARTERS[quarter - 1].label} \${TAX_YEAR}\`,
        quarter,
        usd_sales: usdSales,
        zig_sales: zigSales,
        usd_expenses: { ...usdExpenses },
        zig_expenses: { ...zigExpenses },
        exchange_rate: STUDY_EXCHANGE_RATE,
        tax_rate: CORPORATE_TAX_RATE,
        aids_levy_rate: AIDS_LEVY_RATE,
        previous_qpds_paid_usd: previous.usd,
        previous_qpds_paid_zig: previous.zig,
        assessed_loss_usd: assessedLossUsd,
        assessed_loss_zig: assessedLossZig,
        withholding_credits_usd: withholdingUsd,
        withholding_credits_zig: withholdingZig,
      };

      const storedInput = {
        usd_sales: inputJson.usd_sales,
        zig_sales: inputJson.zig_sales,
        usd_expenses: inputJson.usd_expenses,
        zig_expenses: inputJson.zig_expenses,
        exchange_rate: STUDY_EXCHANGE_RATE,
        tax_rate: CORPORATE_TAX_RATE,
        aids_levy_rate: AIDS_LEVY_RATE,
        quarter,
        previous_qpds_paid_usd: previous.usd,
        previous_qpds_paid_zig: previous.zig,
        assessed_loss_usd: assessedLossUsd,
        assessed_loss_zig: assessedLossZig,
        withholding_credits_usd: withholdingUsd,
        withholding_credits_zig: withholdingZig,
      };

      const record: StudyCalculation = {
        id: createLocalId("study-calculation"),
        business_id: business.id,
        tax_year: TAX_YEAR,
        quarter_label: inputJson.quarter_label,
        quarter,
        input_json: storedInput,
        result_json: result,
        // These begin as the expected net payable, but are NOT counted as
        // payments until the participant explicitly confirms an actual remittance.
        actual_usd_paid: result.net_payable_usd,
        actual_zig_paid: result.net_payable_zig,
        payment_confirmed_at: null,
        created_at: now,
      };
      setState((current) => ({
        ...current,
        calculations: [record, ...current.calculations],
      }));
      setSelectedId(record.id);
      setQuarterLabel("");
    } catch (calculationError) {
      setError(
        calculationError instanceof Error
          ? calculationError.message
          : "The calculation could not be completed. Please try again."
      );
    } finally {
      setCalculating(false);
      setEngineLoading(false);
    }
  }

  function openPaymentEditor(item: StudyCalculation) {
    setPaymentFor(item.id);
    setPaymentUsd(item.payment_confirmed_at ? item.actual_usd_paid ?? 0 : item.result_json.net_payable_usd);
    setPaymentZig(item.payment_confirmed_at ? item.actual_zig_paid ?? 0 : item.result_json.net_payable_zig);
    setPaymentError("");
  }

  function savePayment(event: FormEvent<HTMLFormElement>, item: StudyCalculation) {
    event.preventDefault();
    setPaymentError("");
    if (!validAmount(paymentUsd) || !validAmount(paymentZig)) {
      setPaymentError("Enter non-negative actual payment amounts.");
      return;
    }
    const confirmedAt = new Date().toISOString();
    setState((current) => ({
      ...current,
      calculations: current.calculations.map((calculation) =>
        calculation.id === item.id
          ? {
              ...calculation,
              actual_usd_paid: paymentUsd,
              actual_zig_paid: paymentZig,
              payment_confirmed_at: confirmedAt,
            }
          : calculation
      ),
    }));
    setPaymentFor(null);
  }

  function deleteCalculation(item: StudyCalculation) {
    if (!window.confirm(\`Delete the \${item.quarter_label} calculation from this browser?\`)) return;
    setState((current) => ({
      ...current,
      calculations: current.calculations.filter((calculation) => calculation.id !== item.id),
    }));
    if (selectedId === item.id) setSelectedId(null);
    if (paymentFor === item.id) setPaymentFor(null);
  }

  function clearAllStudyData() {
    if (
      !window.confirm(
        "Clear this study business, every calculation and all recorded payments from this browser? This cannot be undone."
      )
    ) {
      return;
    }
    skipNextSave.current = true;
    clearStudyState();
    setState(EMPTY_STUDY_STATE);
    setSelectedId(null);
    setPaymentFor(null);
    setError("");
    setStoreError("");
    setBusinessName("Khami Timber Enterprises (Pvt) Ltd");
  }

  function exportPdf(item: StudyCalculation) {
    if (!business) return;
    downloadTaxSummaryPdf(business, item);
  }

  function exportExcel(item: StudyCalculation) {
    if (!business) return;
    downloadStudyWorkbook(business, calculations, item);
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper">
        <p className="font-mono text-sm text-ink-faint">Opening study workspace…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link href="/" className="font-display text-xl font-semibold text-ink">
            Twelve C
          </Link>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-usd/30 bg-usd-soft px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-usd">
              Research study mode
            </span>
            <Link href="/learn" className="text-sm text-ink-soft hover:text-ink">
              Learn
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-7 sm:px-6">
        <div className="rounded-lg border border-zig/40 bg-zig-soft px-4 py-3 sm:px-5">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-ink">
            Demo with fictional data only.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            No account is needed. Your fictional business, calculations and confirmed payments stay in this browser.
            This study mode does not send those values to the Twelve C API. Do not enter real client or taxpayer data.
          </p>
        </div>

        <div className="mt-7 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                National University of Science and Technology · usability evaluation
              </p>
              <h1 className="mt-2 font-display text-3xl text-ink sm:text-4xl">
                Try Twelve C without an account.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
                Complete the study tasks using the fictional business and test figures supplied by the researcher.
                The calculation engine runs locally in your browser; it is the same Python engine used by the main app.
              </p>
            </div>

            {!business ? (
              <SectionCard title="Create the fictional business profile" eyebrow="U-01 · Business profile">
                <p className="text-sm text-ink-soft">
                  This creates a local demo profile only. It does not create a Twelve C account or send anything to a server.
                </p>
                <form onSubmit={createBusiness} className="space-y-4">
                  <label className="block">
                    <span className="block text-sm font-medium text-ink-soft">Fictional business name</span>
                    <input
                      value={businessName}
                      onChange={(event) => setBusinessName(event.currentTarget.value)}
                      required
                      maxLength={120}
                      className="mt-1.5 w-full rounded-md border border-line bg-paper px-3 py-2.5 text-sm text-ink outline-none focus:border-seal"
                    />
                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-md bg-paper/70 p-3">
                      <span className="block text-xs text-ink-faint">Tax year</span>
                      <strong className="mt-1 block font-mono text-sm text-ink">{TAX_YEAR}</strong>
                    </div>
                    <div className="rounded-md bg-paper/70 p-3">
                      <span className="block text-xs text-ink-faint">Study exchange rate</span>
                      <strong className="mt-1 block font-mono text-sm text-ink">
                        {fixedRateAvailable ? \`ZiG \${STUDY_EXCHANGE_RATE} / USD\` : "Not configured"}
                      </strong>
                    </div>
                    <div className="rounded-md bg-paper/70 p-3">
                      <span className="block text-xs text-ink-faint">Tax + AIDS levy</span>
                      <strong className="mt-1 block font-mono text-sm text-ink">25% + 3%</strong>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={!fixedRateAvailable}
                    className="rounded-md bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Create local demo profile
                  </button>
                </form>
              </SectionCard>
            ) : (
              <>
                <SectionCard title={business.name} eyebrow="U-01 · Local business profile">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-md bg-paper/70 p-3">
                      <span className="block text-xs text-ink-faint">Tax year</span>
                      <strong className="mt-1 block font-mono text-sm text-ink">{TAX_YEAR}</strong>
                    </div>
                    <div className="rounded-md bg-paper/70 p-3">
                      <span className="block text-xs text-ink-faint">Fixed study rate</span>
                      <strong className="mt-1 block font-mono text-sm text-ink">
                        ZiG {STUDY_EXCHANGE_RATE} / USD
                      </strong>
                    </div>
                    <div className="rounded-md bg-paper/70 p-3">
                      <span className="block text-xs text-ink-faint">Rates applied</span>
                      <strong className="mt-1 block font-mono text-sm text-ink">25% + 3%</strong>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-ink-faint">
                    Exchange rate and tax rates are locked for this research build so participants use the same assumptions.
                  </p>
                </SectionCard>

                <SectionCard title="Enter the quarterly estimate" eyebrow="U-02 to U-05 · Calculation tasks">
                  <p className="text-sm leading-relaxed text-ink-soft">
                    Enter the annual estimate supplied in your task sheet. Use each amount in its original currency.
                    The exchange rate cannot be changed in study mode.
                  </p>
                  <form onSubmit={runCalculation} className="space-y-5">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="block text-sm font-medium text-ink-soft">QPD quarter</span>
                        <select
                          value={quarter}
                          onChange={(event) => setQuarter(Number(event.currentTarget.value))}
                          className="mt-1.5 w-full rounded-md border border-line bg-paper px-3 py-2.5 text-sm text-ink outline-none focus:border-seal"
                        >
                          {QUARTERS.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label} — due {item.date} ({item.cumulative} cumulative)
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium text-ink-soft">Calculation note (optional)</span>
                        <input
                          value={quarterLabel}
                          onChange={(event) => setQuarterLabel(event.currentTarget.value)}
                          maxLength={64}
                          placeholder={\`e.g. \${QUARTERS[quarter - 1].label} estimate\`}
                          className="mt-1.5 w-full rounded-md border border-line bg-paper px-3 py-2.5 text-sm text-ink outline-none focus:border-seal"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <NumberField label="USD sales (annual estimate)" value={usdSales} onChange={setUsdSales} />
                      <NumberField label="ZiG sales (annual estimate)" value={zigSales} onChange={setZigSales} />
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <ExpenseFields
                        title="USD expenses"
                        values={usdExpenses}
                        onChange={(field, value) => changeExpense("USD", field, value)}
                      />
                      <ExpenseFields
                        title="ZiG expenses"
                        values={zigExpenses}
                        onChange={(field, value) => changeExpense("ZiG", field, value)}
                      />
                    </div>

                    <div className="rounded-md border border-line bg-paper/40 p-4">
                      <h3 className="font-display text-base text-ink">Adjustments (optional)</h3>
                      <p className="mt-1 text-xs text-ink-faint">Leave at zero unless the researcher’s scenario specifies an amount.</p>
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <NumberField label="Assessed loss brought forward — USD" value={assessedLossUsd} onChange={setAssessedLossUsd} />
                        <NumberField label="Assessed loss brought forward — ZiG" value={assessedLossZig} onChange={setAssessedLossZig} />
                        <NumberField label="Withholding credits — USD" value={withholdingUsd} onChange={setWithholdingUsd} />
                        <NumberField label="Withholding credits — ZiG" value={withholdingZig} onChange={setWithholdingZig} />
                      </div>
                    </div>

                    <div className="rounded-md bg-paper/70 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm text-ink-soft">Confirmed previous QPD payments</span>
                        <span className="font-mono text-sm text-ink">
                          {money(priorPayments.usd, "USD")} / {money(priorPayments.zig, "ZIG")}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                        Calculated from payments you explicitly confirmed in earlier quarters in this browser.
                      </p>
                    </div>

                    {error && (
                      <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                        {error}
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={calculating || !fixedRateAvailable}
                      className="inline-flex items-center justify-center rounded-md bg-ink px-5 py-3 text-sm font-semibold text-paper transition hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
                    >
                      {calculating
                        ? engineLoading
                          ? "Loading browser calculator / calculating…"
                          : "Calculating…"
                        : "Calculate QPD"}
                    </button>
                    <p className="text-xs leading-relaxed text-ink-faint">
                      The first calculation downloads the versioned browser Python runtime. Your inputs are not sent to that runtime provider.
                    </p>
                  </form>
                </SectionCard>

                {selectedCalculation && (
                  <SectionCard title="Calculation result" eyebrow="Your latest selected run">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-md border border-line bg-paper/60 p-4">
                        <span className="text-xs text-ink-faint">Net payable this quarter — USD</span>
                        <strong className="mt-1 block font-mono text-2xl text-ink">
                          {money(selectedCalculation.result_json.net_payable_usd, "USD")}
                        </strong>
                      </div>
                      <div className="rounded-md border border-line bg-paper/60 p-4">
                        <span className="text-xs text-ink-faint">Net payable this quarter — ZiG</span>
                        <strong className="mt-1 block font-mono text-2xl text-ink">
                          {money(selectedCalculation.result_json.net_payable_zig, "ZIG")}
                        </strong>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div>
                        <span className="text-xs text-ink-faint">Total annual tax (USD)</span>
                        <p className="mt-1 font-mono text-sm text-ink">{money(selectedCalculation.result_json.total_tax_usd, "USD")}</p>
                      </div>
                      <div>
                        <span className="text-xs text-ink-faint">Total annual tax (ZiG)</span>
                        <p className="mt-1 font-mono text-sm text-ink">{money(selectedCalculation.result_json.total_tax_zig, "ZIG")}</p>
                      </div>
                      <div>
                        <span className="text-xs text-ink-faint">Cumulative target</span>
                        <p className="mt-1 font-mono text-sm text-ink">{percent(selectedCalculation.result_json.cumulative_percentage)}</p>
                      </div>
                      <div>
                        <span className="text-xs text-ink-faint">Previous paid (USD)</span>
                        <p className="mt-1 font-mono text-sm text-ink">{money(selectedCalculation.result_json.previous_paid_usd, "USD")}</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto rounded-md border border-line">
                      <table className="w-full min-w-[460px] text-sm">
                        <thead className="bg-paper/70 text-left text-xs text-ink-faint">
                          <tr>
                            <th className="px-3 py-2">QPD</th>
                            <th className="px-3 py-2">Instalment</th>
                            <th className="px-3 py-2 text-right">USD</th>
                            <th className="px-3 py-2 text-right">ZiG</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCalculation.result_json.schedule.map((item, index) => (
                            <tr key={item.label} className="border-t border-line">
                              <td className="px-3 py-2">{QUARTERS[index]?.label ?? item.label}</td>
                              <td className="px-3 py-2">{percent(item.percentage)}</td>
                              <td className="px-3 py-2 text-right font-mono">{money(item.usd, "USD")}</td>
                              <td className="px-3 py-2 text-right font-mono">{money(item.zig, "ZIG")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => exportPdf(selectedCalculation)}
                        className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink-soft hover:bg-paper"
                      >
                        Download PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => exportExcel(selectedCalculation)}
                        className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink-soft hover:bg-paper"
                      >
                        Download Excel working papers
                      </button>
                    </div>
                  </SectionCard>
                )}

                <SectionCard title="Calculation and payment history" eyebrow="U-03 · Record a payment">
                  {calculations.length === 0 ? (
                    <p className="text-sm text-ink-faint">Your completed calculations will appear here.</p>
                  ) : (
                    <div className="space-y-3">
                      {calculations.map((item) => (
                        <div key={item.id} className="rounded-md border border-line bg-paper/40 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => setSelectedId(item.id)}
                              className="text-left"
                            >
                              <strong className="block text-sm text-ink">{item.quarter_label}</strong>
                              <span className="mt-1 block text-xs text-ink-faint">
                                {formatDateTime(item.created_at)} · {item.result_json.due_date}
                              </span>
                            </button>
                            <div className="text-right">
                              <p className="font-mono text-sm text-ink">
                                {money(item.result_json.net_payable_usd, "USD")} / {money(item.result_json.net_payable_zig, "ZIG")}
                              </p>
                              <p className={\`mt-1 text-xs \${item.payment_confirmed_at ? "text-usd" : "text-ink-faint"}\`}>
                                {item.payment_confirmed_at ? "Payment confirmed" : "Not yet confirmed"}
                              </p>
                            </div>
                          </div>

                          {paymentFor === item.id ? (
                            <form onSubmit={(event) => savePayment(event, item)} className="mt-3 border-t border-line pt-3">
                              <p className="text-sm font-medium text-ink">Enter the amount actually paid to ZIMRA</p>
                              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <NumberField label="Actual USD paid" value={paymentUsd} onChange={setPaymentUsd} />
                                <NumberField label="Actual ZiG paid" value={paymentZig} onChange={setPaymentZig} />
                              </div>
                              {paymentError && <p role="alert" className="mt-2 text-xs text-danger">{paymentError}</p>}
                              <div className="mt-3 flex gap-2">
                                <button type="submit" className="rounded-md bg-ink px-3 py-2 text-xs font-semibold text-paper">Save confirmed payment</button>
                                <button type="button" onClick={() => setPaymentFor(null)} className="rounded-md border border-line px-3 py-2 text-xs text-ink-soft">Cancel</button>
                              </div>
                            </form>
                          ) : (
                            <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                              <button
                                type="button"
                                onClick={() => openPaymentEditor(item)}
                                className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-surface"
                              >
                                {item.payment_confirmed_at ? "Edit confirmed payment" : "Record actual payment"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedId(item.id)}
                                className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface"
                              >
                                View result
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteCalculation(item)}
                                className="rounded-md px-3 py-1.5 text-xs text-danger hover:bg-danger-soft"
                              >
                                Delete run
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </>
            )}
          </div>

          <aside className="space-y-4">
            <section className="rounded-lg border border-line bg-surface p-5 shadow-card">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">Study controls</p>
              <h2 className="mt-1 font-display text-lg text-ink">Your browser session</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-faint">Saved calculations</dt>
                  <dd className="font-mono text-ink">{calculations.length}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-faint">Storage</dt>
                  <dd className="font-mono text-usd">This browser only</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-faint">Tax year</dt>
                  <dd className="font-mono text-ink">{TAX_YEAR}</dd>
                </div>
              </dl>
              {storeError && (
                <p role="alert" className="mt-3 rounded-md bg-danger-soft p-2 text-xs text-danger">{storeError}</p>
              )}
              <button
                type="button"
                onClick={clearAllStudyData}
                className="mt-5 w-full rounded-md border border-danger/30 px-3 py-2 text-sm font-medium text-danger hover:bg-danger-soft"
              >
                Clear demo data
              </button>
              <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                Clearing removes the local business profile, calculations and confirmed payments from this browser. It does not affect a normal Twelve C account.
              </p>
            </section>

            <section className="rounded-lg border border-line bg-surface p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">Frozen build identity</p>
              <h2 className="mt-1 font-display text-lg text-ink">Engine fingerprint</h2>
              {manifest ? (
                <dl className="mt-3 space-y-3 text-xs">
                  <div>
                    <dt className="text-ink-faint">Application commit</dt>
                    <dd className="mt-1 break-all font-mono text-ink">{manifest.buildCommit}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Calculator SHA-256</dt>
                    <dd className="mt-1 break-all font-mono text-ink">{manifest.calculatorSha256}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Tax rules SHA-256</dt>
                    <dd className="mt-1 break-all font-mono text-ink">{manifest.taxRulesSha256}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Browser runtime</dt>
                    <dd className="mt-1 font-mono text-ink">Pyodide {manifest.pyodideVersion}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                  Build fingerprint will appear after the study engine has been included in a production build.
                </p>
              )}
            </section>

            <section className="rounded-lg border border-line bg-paper/70 p-5">
              <h2 className="font-display text-lg text-ink">Before you begin</h2>
              <ul className="mt-3 space-y-2 text-xs leading-relaxed text-ink-soft">
                <li>Use only the fictional figures supplied by the researcher.</li>
                <li>Use the same browser for the whole session.</li>
                <li>Confirm a payment only when the task tells you to record one.</li>
                <li>Export files are generated locally; they are not uploaded.</li>
                <li>Do not enter real company, client, TIN or personal data.</li>
              </ul>
            </section>

            <Link href="/tutorial" className="block rounded-lg border border-line bg-surface p-4 text-sm text-ink-soft hover:bg-paper">
              Read how Twelve C works <span className="float-right text-usd">→</span>
            </Link>
          </aside>
        </div>
      </div>
    </main>
  );
}
