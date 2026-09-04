"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { OverdueDigest, DigestItem } from "@/components/OverdueDigest";
import { Button, Card, ErrorNote, Eyebrow, Field } from "@/components/ui";
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
// one-line badge on each dashboard business card rather than a full panel.
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

const BADGE_STYLES: Record<NextDueBadge["tone"], string> = {
  danger: "border-danger/30 bg-danger-soft text-danger",
  warn: "border-zig/40 bg-zig-soft text-zig",
  ok: "border-usd/30 bg-usd-soft text-usd",
};

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

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Eyebrow>Your businesses</Eyebrow>
            <h1 className="mt-1 font-display text-3xl text-ink sm:text-4xl">Dashboard</h1>
          </div>
          <Button variant="primary" onClick={() => setShowForm((s) => !s)} className="w-full sm:w-auto">
            {showForm ? "Cancel" : "+ Add a business"}
          </Button>
        </div>

        <ErrorNote>{error}</ErrorNote>

        {showForm && (
          <Card className="mt-6 border-usd/30 shadow-glow-usd">
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

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {businesses === null && (
            <>
              {[0, 1, 2].map((i) => (
                <div key={i} className="glass h-44 animate-pulse rounded-lg" />
              ))}
            </>
          )}
          {businesses?.length === 0 && (
            <Card className="sm:col-span-2 xl:col-span-3">
              <p className="text-sm text-ink-soft">
                No businesses yet. Add one above to run your first QPD calculation.
              </p>
            </Card>
          )}
          {businesses?.map((b) => {
            const badge = nextDueBadge(calcByBusiness.get(b.id));
            const initials = b.name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase())
              .join("");
            return (
              <Card
                key={b.id}
                className="group flex h-full flex-col transition duration-200 ease-snap hover:-translate-y-0.5 hover:border-usd/60 hover:shadow-glow-usd"
              >
                <Link href={`/dashboard/${b.id}`} className="flex flex-1 flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-signal-gradient font-mono text-sm font-semibold text-paper shadow-glow-sm">
                        {initials || "?"}
                      </span>
                      <h3 className="font-display text-lg text-ink transition group-hover:text-usd">{b.name}</h3>
                    </div>
                    {badge && (
                      <span
                        className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${BADGE_STYLES[badge.tone]}`}
                      >
                        {badge.label}
                      </span>
                    )}
                  </div>
                  {badge?.amount && (
                    <p className="mt-2 font-mono text-sm tabular-nums text-ink-soft">{badge.amount}</p>
                  )}
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-xs text-ink-soft">
                    <div className="rounded-md border border-line bg-paper/50 px-2 py-1.5 text-center">
                      <dt className="text-[10px] uppercase tracking-wide text-ink-faint">Rate</dt>
                      <dd className="mt-0.5 font-mono tabular-nums text-ink">{b.default_exchange_rate}</dd>
                    </div>
                    <div className="rounded-md border border-line bg-paper/50 px-2 py-1.5 text-center">
                      <dt className="text-[10px] uppercase tracking-wide text-ink-faint">Tax</dt>
                      <dd className="mt-0.5 font-mono tabular-nums text-ink">{(b.default_tax_rate * 100).toFixed(0)}%</dd>
                    </div>
                    <div className="rounded-md border border-line bg-paper/50 px-2 py-1.5 text-center">
                      <dt className="text-[10px] uppercase tracking-wide text-ink-faint">AIDS</dt>
                      <dd className="mt-0.5 font-mono tabular-nums text-ink">{(b.default_aids_levy_rate * 100).toFixed(0)}%</dd>
                    </div>
                  </dl>
                </Link>

                <div className="mt-4 border-t border-line pt-3">
                  {confirmingDeleteId === b.id ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-danger">
                        {`Delete "${b.name}" and all its calculations? This can't be undone.`}
                      </span>
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => onDelete(b.id)}
                          disabled={deletingId === b.id}
                          className="rounded-md bg-danger px-2.5 py-1 text-xs font-semibold text-paper transition disabled:opacity-50"
                        >
                          {deletingId === b.id ? "Deleting…" : "Yes, delete"}
                        </button>
                        <button
                          onClick={() => setConfirmingDeleteId(null)}
                          className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-soft transition hover:text-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingDeleteId(b.id)}
                      className="text-xs text-ink-faint transition duration-150 hover:text-danger"
                    >
                      Delete business
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
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