"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { Button, Card, ErrorNote, Eyebrow, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { Business } from "@/lib/types";

function DashboardContent() {
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [rate, setRate] = useState("26.8");
  const [taxRate, setTaxRate] = useState("0.25");
  const [aidsLevy, setAidsLevy] = useState("0.03");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const data = await api.listBusinesses();
      setBusinesses(data);
    } catch {
      setError("Couldn't load your businesses. Is the API running?");
    }
  }

  useEffect(() => {
    load();
  }, []);

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
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="flex items-center justify-between">
          <div>
            <Eyebrow>Your businesses</Eyebrow>
            <h1 className="mt-1 font-display text-3xl text-ink">Dashboard</h1>
          </div>
          <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cancel" : "Add a business"}
          </Button>
        </div>

        <ErrorNote>{error}</ErrorNote>

        {showForm && (
          <Card className="mt-6">
            <h2 className="font-display text-xl text-ink">New business</h2>
            <form className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={onCreate}>
              <div className="md:col-span-2">
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
              <div className="md:col-span-2">
                <Button type="submit" variant="primary" disabled={submitting}>
                  {submitting ? "Creating…" : "Create business"}
                </Button>
              </div>
            </form>
          </Card>
        )}

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          {businesses === null && <p className="text-sm text-ink-faint">Loading businesses…</p>}
          {businesses?.length === 0 && (
            <Card className="md:col-span-2">
              <p className="text-sm text-ink-soft">
                No businesses yet. Add one above to run your first QPD calculation.
              </p>
            </Card>
          )}
          {businesses?.map((b) => (
            <Link key={b.id} href={`/dashboard/${b.id}`}>
              <Card className="h-full transition hover:border-usd">
                <h3 className="font-display text-lg text-ink">{b.name}</h3>
                <dl className="mt-3 space-y-1 text-sm text-ink-soft">
                  <div className="flex justify-between">
                    <dt>Exchange rate</dt>
                    <dd className="font-mono tabular-nums">{b.default_exchange_rate}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Tax rate</dt>
                    <dd className="font-mono tabular-nums">{(b.default_tax_rate * 100).toFixed(0)}%</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>AIDS levy</dt>
                    <dd className="font-mono tabular-nums">{(b.default_aids_levy_rate * 100).toFixed(0)}%</dd>
                  </div>
                </dl>
              </Card>
            </Link>
          ))}
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
