$ErrorActionPreference = "Stop"


function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $Content = $Content.Replace("{{MIDDOT}}", [string][char]0x00B7)
    $Content = $Content.Replace("{{EMDASH}}", [string][char]0x2014)
    $Content = $Content.Replace("{{MINUS}}", [string][char]0x2212)
    $Content = $Content.Replace("{{ELLIPSIS}}", [string][char]0x2026)
    $Content = $Content.Replace("{{RSQUO}}", [string][char]0x2019)
    $Content = $Content.Replace("{{CHECK}}", [string][char]0x2713)
    $full = Join-Path -Path (Get-Location) -ChildPath $Path
    $dir = Split-Path -Path $full -Parent
    if (!(Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($full, $Content, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "Wrote $Path"
}

$content1 = @'
"use client";

import Link from "next/link";
import {
  InputHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { LogoMark } from "@/components/LogoMark";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-xl tracking-tight text-ink ${className}`}>
      <LogoMark size={22} />
      Twelve<span className="text-seal">C</span>
    </span>
  );
}

export function Field({
  label,
  hint,
  emptyIfZero,
  value,
  placeholder,
  ...props
}: {
  label: string;
  hint?: string;
  /** For currency-style number fields: show a blank box with a "0.00"
   *  placeholder instead of a literal "0" sitting in the field. Purely
   *  cosmetic - the bound value is still 0 underneath. */
  emptyIfZero?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) {
  const displayValue = emptyIfZero && (value === 0 || value === "0") ? "" : value;
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-soft">{label}</span>
      <input
        {...props}
        value={displayValue}
        placeholder={emptyIfZero ? "0.00" : placeholder}
        className={`w-full rounded border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-seal placeholder:text-ink-faint/50 ${props.className ?? ""}`}
      />
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: { variant?: "primary" | "secondary" | "ghost" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold transition duration-150 ease-snap disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    // Warms to seal gold on hover instead of glowing - a stamp being
    // pressed, not a light turning on.
    primary: "bg-ink text-paper hover:bg-seal hover:text-ink",
    secondary: "border border-ink text-ink hover:bg-ink hover:text-paper",
    ghost: "text-ink-soft hover:text-ink",
  };
  return <button {...props} className={`${base} ${variants[variant]} ${className}`} />;
}

export function Card({
  children,
  className = "",
  letterhead = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Adds the seal-gold top rule, for a card that represents something
   *  official/on-record (a filed calculation, a confirmed business). */
  letterhead?: boolean;
}) {
  return (
    <div
      className={`rounded-md border border-line bg-surface p-6 shadow-card ${letterhead ? "letterhead" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function SealMark({ children }: { children: React.ReactNode }) {
  return <span className="seal-mark">{children}</span>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-medium text-ink-faint">{children}</span>;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
      {children}
    </div>
  );
}

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-ink-soft transition hover:text-ink">
      {children}
    </Link>
  );
}

export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
  className = "",
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`inline-flex w-full gap-0.5 overflow-x-auto rounded-md border border-line bg-surface-2 p-1 sm:w-auto ${className}`}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`shrink-0 whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium transition duration-150 ease-snap ${
            active === tab.id
              ? "bg-seal text-ink"
              : "text-ink-faint hover:bg-surface hover:text-ink-soft"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Numbered step indicator for a multi-step form. A step is only clickable
 * once it's been reached (`index <= furthest`) - you can jump back to fix
 * something, but not skip ahead of validation by clicking a future step
 * that hasn't been unlocked yet.
 */
export function Stepper({
  steps,
  current,
  furthest,
  onStepClick,
}: {
  steps: string[];
  current: number;
  furthest: number;
  onStepClick: (index: number) => void;
}) {
  return (
    <ol className="flex w-full items-center">
      {steps.map((label, i) => {
        const reachable = i <= furthest;
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className={`flex items-center ${i < steps.length - 1 ? "flex-1" : ""}`}>
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onStepClick(i)}
              className="flex shrink-0 items-center gap-2 disabled:cursor-not-allowed"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold transition duration-150 ${
                  active
                    ? "bg-ink text-paper"
                    : done
                    ? "bg-seal text-ink"
                    : reachable
                    ? "border border-line text-ink-soft"
                    : "border border-line text-ink-faint/50"
                }`}
              >
                {done ? "\u2713" : i + 1}
              </span>
              <span
                className={`hidden text-sm font-medium sm:inline ${
                  active ? "text-ink" : reachable ? "text-ink-soft" : "text-ink-faint/50"
                }`}
              >
                {label}
              </span>
            </button>
            {i < steps.length - 1 && (
              <span className={`mx-3 h-px flex-1 ${i < current ? "bg-seal" : "bg-line"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Generic dropdown menu primitive - closes on outside click, Escape, or any
 * click inside its panel (so DropdownItem links and action buttons both
 * close it automatically without each one needing its own handler).
 */
export function Dropdown({
  trigger,
  children,
  align = "left",
}: {
  trigger: (state: { open: boolean }) => ReactNode;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {trigger({ open })}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          className={`fade-in-up absolute z-50 mt-2 min-w-[15.5rem] overflow-hidden rounded-xl border border-line bg-surface py-1.5 shadow-card-raised ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return (
    <div className="truncate px-3 py-1.5 text-xs font-medium text-ink-faint">
      {children}
    </div>
  );
}

export function DropdownDivider() {
  return <div className="my-1 border-t border-line" />;
}

export function DropdownItem({
  href,
  onClick,
  active = false,
  danger = false,
  children,
}: {
  href?: string;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  const className = `block w-full truncate px-3.5 py-2.5 text-left text-sm transition duration-150 ${
    danger
      ? "text-danger hover:bg-danger-soft"
      : active
      ? "bg-usd-soft text-usd"
      : "text-ink-soft hover:bg-seal-soft hover:text-ink"
  }`;
  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}

export function ChevronDown({ open = false }: { open?: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="10"
      height="10"
      className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
      fill="none"
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrashIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" className={`shrink-0 ${className}`}>
      <path
        d="M3 4.5h10M6.4 4.5V3.2a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v1.3M4.6 4.5l.5 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.5-8.1M6.7 7.2v3.6M9.3 7.2v3.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Centered overlay dialog - closes on Escape, backdrop click, or the
 * close button. Content clicks are stopped from bubbling to the backdrop
 * so forms/buttons inside work normally.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-ink/50 px-4 py-10"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`fade-in-up letterhead w-full max-w-lg rounded-lg border border-line bg-surface p-6 shadow-card-raised ${className}`}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="font-display text-lg text-ink">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-ink-faint transition duration-150 hover:bg-surface-2 hover:text-ink"
            >
              <CloseIcon />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** A small pill badge used on history rows ("Latest", "Viewing"). */
export function Badge({
  children,
  variant = "solid",
}: {
  children: ReactNode;
  variant?: "solid" | "outline";
}) {
  const className =
    variant === "solid"
      ? "rounded-full bg-seal px-2.5 py-0.5 text-xs font-medium text-ink"
      : "rounded-full border border-usd/60 px-2.5 py-0.5 text-xs font-medium text-usd";
  return <span className={className}>{children}</span>;
}

'@

Write-Utf8NoBom -Path "src/components/ui.tsx" -Content $content1


$content2 = @'
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
                        ZiG {exchangeRate ?? "{{ELLIPSIS}}"}/USD {{MIDDOT}}{" "}
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

'@

Write-Utf8NoBom -Path "src/app/dashboard/[businessId]/new/page.tsx" -Content $content2


Write-Host ""
Write-Host "Done. Now run:"
Write-Host "  git add -A"
Write-Host '  git commit -m "Stage 2: New Calculation as a 4-step wizard (Period / Income / Deductions / Review)"'
Write-Host "  git push"
