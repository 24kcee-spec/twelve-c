"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { OverdueDigest, DigestItem } from "@/components/OverdueDigest";
import { Button, Card, ErrorNote, Eyebrow, Field, TrashIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { Business, QpdCalculationOut } from "@/lib/types";
import { money } from "@/lib/format";

const QUARTER_DATES = [
  { month: 2, day: 25 }, // Q1 - 25 March
  { month: 5, day: 25 }, // Q2 - 25 June
  { month: 8, day: 25 }, // Q3 - 25 September
  { month: 11, day: 20 }, // Q4 - 20 December
];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

interface NextDueBadge {
  tone: "danger" | "warn" | "ok";
  label: string;
  amount: string | null;
}

// Compact version of the logic in NextPaymentDue/OverdueDigest, sized for a
// one-line status on each dashboard ledger row rather than a full panel.
function nextDueBadge(calc: QpdCalculationOut | null | undefined): NextDueBadge | null {
  if (!calc) return null;
  const today = startOfDay(new Date());
  const withDates = calc.result_json.schedule.map((inst, i) => {
    const { month, day } = QUARTER_DATES[i];
    return {
      ...inst,
      date: new Date(calc.tax_year, month, day),
      paid: inst.usd_balance <= 0.01 && inst.zig_balance <= 0.01,
    };
  });

  const overdue = withDates.filter((i) => !i.paid && i.date < today);
  if (overdue.length > 0) {
    const usdOwed = overdue.reduce((s, i) => s + i.usd_balance, 0);
    const zigOwed = overdue.reduce((s, i) => s + i.zig_balance, 0);
    return {
      tone: "danger",
      label: overdue.length === 1 ? "1 instalment overdue" : `${overdue.length} instalments overdue`,
      amount: `${money(usdOwed, "USD")} / ${money(zigOwed, "ZIG")}`,
    };
  }

  const upcoming = withDates
    .filter((i) => !i.paid && i.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (upcoming.length > 0) {
    const next = upcoming[0];
    const days = Math.round((next.date.getTime() - today.getTime()) / 86400000);
    return {
      tone: days <= 14 ? "warn" : "ok",
      label: days === 0 ? "Due today" : `Due in ${days}d`,
      amount: `${money(next.usd_balance, "USD")} / ${money(next.zig_balance, "ZIG")}`,
    };
  }

  return { tone: "ok", label: "All instalments paid", amount: null };
}

const STATUS_DOT: Record<NextDueBadge["tone"], string> = {
  danger: "bg-danger",
  warn: "bg-zig",
  ok: "bg-usd",
};
const STATUS_TEXT: Record<NextDueBadge["tone"], string> = {
  danger: "text-danger font-medium",
  warn: "text-zig",
  ok: "text-usd",
};

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" className="shrink-0 text-ink-faint">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DashboardContent() {
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [digestItems, setDigestItems] = useState<DigestItem[]>([]);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [rate, setRate] = useState("26.8");
  const [taxRate, setTaxRate] = useState("0.25");
  const [aidsLevy, setAidsLevy] = useState("0.03");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const data = await api.listBusinesses();
      setBusinesses(data);

      const items = await Promise.all(
        data.map(async (business) => {
          try {
            const calcs = await api.listCalculations(business.id);
            return { business, latestCalc: calcs[0] ?? null };
          } catch {
            return { business, latestCalc: null };
          }
        })
      );
      setDigestItems(items);
    } catch {
      setError("Couldn't load your businesses. Is the API running?");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onDelete(id: string) {
    setDeletingId(id);
    setError("");
    try {
      await api.deleteBusiness(id);
      setBusinesses((prev) => prev?.filter((b) => b.id !== id) ?? null);
      setDigestItems((prev) => prev.filter((d) => d.business.id !== id));
      setConfirmingDeleteId(null);
    } catch {
      setError("Couldn't delete that business. Try again in a moment.");
    } finally {
      setDeletingId(null);
    }
  }

  const calcByBusiness = new Map(digestItems.map((d) => [d.business.id, d.latestCalc]));

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.createBusiness({
        name,
        default_exchange_rate: parseFloat(rate),
        default_tax_rate: parseFloat(taxRate),
        default_aids_levy_rate: parseFloat(aidsLevy),
      });
      setName("");
      setShowForm(false);
      await load();
    } catch {
      setError("Couldn't create that business. Check the values and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper">
      <TopBar />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <OverdueDigest items={digestItems} />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl text-ink sm:text-4xl">Dashboard</h1>
            <p className="mt-1.5 text-sm text-ink-soft">Track and file every business&rsquo;s QPD in one place.</p>
          </div>
          <Button variant="primary" onClick={() => setShowForm((s) => !s)} className="w-full sm:w-auto">
            {showForm ? "Cancel" : "+ Add a business"}
          </Button>
        </div>

        <ErrorNote>{error}</ErrorNote>

        {showForm && (
          <Card className="mt-6" letterhead>
            <h2 className="font-display text-xl text-ink">New business</h2>
            <form className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={onCreate}>
              <div className="sm:col-span-2">
                <Field label="Business name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <Field
                label="Default exchange rate (ZiG per 1 USD)"
                type="number"
                step="0.01"
                required
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
              <Field
                label="Corporate tax rate"
                type="number"
                step="0.01"
                required
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                hint="0.25 = 25%"
              />
              <Field
                label="AIDS levy rate"
                type="number"
                step="0.01"
                required
                value={aidsLevy}
                onChange={(e) => setAidsLevy(e.target.value)}
                hint="0.03 = 3% of tax payable"
              />
              <div className="sm:col-span-2">
                <Button type="submit" variant="primary" disabled={submitting} className="w-full sm:w-auto">
                  {submitting ? "Creating…" : "Create business"}
                </Button>
              </div>
            </form>
          </Card>
        )}

        <div className="mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-xl text-ink">Your businesses</h2>
            {businesses && businesses.length > 0 && (
              <Eyebrow>{businesses.length === 1 ? "1 business" : `${businesses.length} businesses`}</Eyebrow>
            )}
          </div>

          {businesses === null && (
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
              {[0, 1, 2].map((i) => (
                <div key={i} className={`border-b border-line p-5 last:border-b-0 ${i > 0 ? "" : ""}`}>
                  <div className="h-4 w-40 animate-pulse rounded bg-paper" />
                  <div className="mt-3 h-3 w-24 animate-pulse rounded bg-paper" />
                </div>
              ))}
            </div>
          )}

          {businesses?.length === 0 && (
            <Card>
              <p className="text-sm text-ink-soft">
                No businesses yet. Add one above to run your first QPD calculation.
              </p>
            </Card>
          )}

          {businesses && businesses.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card-raised">
              <div className={`hidden grid-cols-[2.2fr_1.1fr_1.8fr_1.4fr_18px_26px] gap-4 px-6 py-3 text-xs font-medium text-ink-faint sm:grid`}>
                <span>Business</span>
                <span>Status</span>
                <span>Rate</span>
                <span className="text-right">Amount due</span>
                <span />
                <span />
              </div>

              {businesses.map((b, idx) => {
                const badge = nextDueBadge(calcByBusiness.get(b.id));
                const initials = b.name
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase())
                  .join("");
                const isConfirming = confirmingDeleteId === b.id;

                if (isConfirming) {
                  return (
                    <div
                      key={b.id}
                      className={`flex flex-wrap items-center justify-between gap-3 px-6 py-4 ${
                        idx > 0 ? "border-t border-line" : ""
                      }`}
                    >
                      <span className="text-sm text-danger">
                        {`Delete "${b.name}" and all its calculations? This can't be undone.`}
                      </span>
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => onDelete(b.id)}
                          disabled={deletingId === b.id}
                          className="rounded-md bg-danger px-3 py-1.5 text-xs font-semibold text-paper transition disabled:opacity-50"
                        >
                          {deletingId === b.id ? "Deleting…" : "Yes, delete"}
                        </button>
                        <button
                          onClick={() => setConfirmingDeleteId(null)}
                          className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft transition hover:text-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={b.id} className={`group transition duration-150 hover:bg-seal-soft ${idx > 0 ? "border-t border-line" : ""}`}>
                    {/* Mobile: stacked */}
                    <div className="flex flex-col gap-2 px-6 py-4 sm:hidden">
                      <div className="flex items-center justify-between gap-3">
                        <Link href={`/dashboard/${b.id}`} className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-seal font-mono text-xs font-semibold text-ink">
                            {initials || "?"}
                          </span>
                          <span className="truncate font-display text-base text-ink">{b.name}</span>
                        </Link>
                        <button
                          onClick={() => setConfirmingDeleteId(b.id)}
                          aria-label={`Delete ${b.name}`}
                          className="shrink-0 rounded-md p-1.5 text-ink-faint transition duration-150 hover:bg-danger-soft hover:text-danger"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                      {badge && (
                        <Link href={`/dashboard/${b.id}`} className={`flex items-center gap-2 text-sm ${STATUS_TEXT[badge.tone]}`}>
                          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[badge.tone]}`} />
                          {badge.label}
                        </Link>
                      )}
                      <Link
                        href={`/dashboard/${b.id}`}
                        className={`font-mono text-sm ${badge?.tone === "danger" ? "font-semibold text-danger" : "text-ink"}`}
                      >
                        {badge?.amount ?? <span className="text-ink-faint">No balance due</span>}
                      </Link>
                    </div>

                    {/* Desktop: ledger row */}
                    <div className="hidden grid-cols-[2.2fr_1.1fr_1.8fr_1.4fr_18px_26px] items-center gap-4 px-6 py-4 sm:grid">
                      <Link href={`/dashboard/${b.id}`} className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-seal font-mono text-xs font-semibold text-ink">
                          {initials || "?"}
                        </span>
                        <span className="truncate font-display text-base text-ink transition group-hover:text-usd">
                          {b.name}
                        </span>
                      </Link>

                      {badge ? (
                        <Link href={`/dashboard/${b.id}`} className={`flex items-center gap-2 text-sm ${STATUS_TEXT[badge.tone]}`}>
                          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[badge.tone]}`} />
                          {badge.label}
                        </Link>
                      ) : (
                        <span />
                      )}

                      <Link href={`/dashboard/${b.id}`} className="text-sm text-ink-soft">
                        ZiG {b.default_exchange_rate}/USD, {(b.default_tax_rate * 100).toFixed(0)}% tax +{" "}
                        {(b.default_aids_levy_rate * 100).toFixed(0)}% AIDS levy
                      </Link>

                      <Link
                        href={`/dashboard/${b.id}`}
                        className={`text-right font-mono text-sm ${badge?.tone === "danger" ? "font-semibold text-danger" : "text-ink"}`}
                      >
                        {badge?.amount ?? <span className="text-ink-faint">No balance due</span>}
                      </Link>

                      <Link href={`/dashboard/${b.id}`}>
                        <ChevronRight />
                      </Link>

                      <button
                        onClick={() => setConfirmingDeleteId(b.id)}
                        aria-label={`Delete ${b.name}`}
                        className="justify-self-end rounded-md p-1.5 text-ink-faint opacity-0 transition duration-150 hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}
