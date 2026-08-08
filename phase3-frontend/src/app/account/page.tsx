"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { Button, Card, ErrorNote, Eyebrow, Field } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { ApiError, Business, MfaSetupResponse } from "@/lib/types";

function AccountContent() {
  const { user, refreshUser } = useAuth();
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [rateDrafts, setRateDrafts] = useState<Record<string, { rate: string; tax: string; levy: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [ratesError, setRatesError] = useState("");

  useEffect(() => {
    api
      .listBusinesses()
      .then((data) => {
        setBusinesses(data);
        const drafts: Record<string, { rate: string; tax: string; levy: string }> = {};
        data.forEach((b) => {
          drafts[b.id] = {
            rate: String(b.default_exchange_rate),
            tax: String(b.default_tax_rate),
            levy: String(b.default_aids_levy_rate),
          };
        });
        setRateDrafts(drafts);
      })
      .catch(() => setBusinesses([]));
  }, []);

  function updateDraft(id: string, field: "rate" | "tax" | "levy", value: string) {
    setRateDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function saveRates(id: string) {
    const draft = rateDrafts[id];
    if (!draft) return;
    setRatesError("");
    setSavingId(id);
    setSavedId(null);
    try {
      const updated = await api.updateBusiness(id, {
        default_exchange_rate: parseFloat(draft.rate),
        default_tax_rate: parseFloat(draft.tax),
        default_aids_levy_rate: parseFloat(draft.levy),
      });
      setBusinesses((prev) => prev?.map((b) => (b.id === id ? updated : b)) ?? null);
      setSavedId(id);
      setTimeout(() => setSavedId((cur) => (cur === id ? null : cur)), 2000);
    } catch {
      setRatesError("Couldn't save those rates. Check the values and try again.");
    } finally {
      setSavingId(null);
    }
  }

  async function startSetup() {
    setError("");
    setBusy(true);
    try {
      const res = await api.mfaSetup();
      setSetup(res);
    } catch (err) {
      setError(err instanceof ApiError && typeof err.detail === "string" ? err.detail : "Couldn't start MFA setup");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.mfaVerify(code);
      setSetup(null);
      setCode("");
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError && typeof err.detail === "string" ? err.detail : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  async function disableMfa(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.mfaDisable(code);
      setCode("");
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError && typeof err.detail === "string" ? err.detail : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper">
      <TopBar />
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Eyebrow>Account</Eyebrow>
        <h1 className="mt-1 font-display text-3xl text-ink">{user?.email}</h1>

        <Card className="mt-8">
          <Eyebrow>Business rate settings</Eyebrow>
          <p className="mt-1 text-sm text-ink-soft">
            Update the default exchange rate, tax rate, and AIDS levy rate for
            each business. This only changes future calculations — past ones
            keep the exact rate that was used at the time.
          </p>

          <ErrorNote>{ratesError}</ErrorNote>

          {businesses === null && <p className="mt-4 text-sm text-ink-faint">Loading...</p>}
          {businesses?.length === 0 && (
            <p className="mt-4 text-sm text-ink-faint">No businesses yet.</p>
          )}

          <div className="mt-4 space-y-4">
            {businesses?.map((b) => {
              const draft = rateDrafts[b.id];
              if (!draft) return null;
              return (
                <div key={b.id} className="rounded border border-line p-4">
                  <p className="font-medium text-ink">{b.name}</p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field
                      label="Exchange rate"
                      type="number"
                      step="0.01"
                      value={draft.rate}
                      onChange={(e) => updateDraft(b.id, "rate", e.target.value)}
                      hint="ZiG per 1 USD"
                    />
                    <Field
                      label="Tax rate"
                      type="number"
                      step="0.01"
                      value={draft.tax}
                      onChange={(e) => updateDraft(b.id, "tax", e.target.value)}
                      hint="0.25 = 25%"
                    />
                    <Field
                      label="AIDS levy rate"
                      type="number"
                      step="0.01"
                      value={draft.levy}
                      onChange={(e) => updateDraft(b.id, "levy", e.target.value)}
                      hint="0.03 = 3%"
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <Button
                      variant="secondary"
                      onClick={() => saveRates(b.id)}
                      disabled={savingId === b.id}
                    >
                      {savingId === b.id ? "Saving..." : "Save rates"}
                    </Button>
                    {savedId === b.id && (
                      <span className="text-xs text-usd">Saved</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="mt-6">
          <Eyebrow>Two-factor authentication</Eyebrow>
          <p className="mt-1 text-sm text-ink-soft">
            {user?.mfa_enabled
              ? "Enabled — a 6-digit code is required at every login."
              : "Not enabled. Add an authenticator app for a second layer of protection on your tax data."}
          </p>

          <ErrorNote>{error}</ErrorNote>

          {!user?.mfa_enabled && !setup && (
            <Button variant="primary" className="mt-4" onClick={startSetup} disabled={busy}>
              Set up two-factor authentication
            </Button>
          )}

          {setup && (
            <div className="mt-4 space-y-4">
              <img
                src={setup.qr_code_data_uri}
                alt="Scan this QR code with your authenticator app"
                className="h-40 w-40 rounded border border-line"
              />
              <p className="text-xs text-ink-faint break-all">
                Can&apos;t scan? Enter this manually: {setup.provisioning_uri}
              </p>
              <form className="flex items-end gap-3" onSubmit={confirmSetup}>
                <Field
                  label="6-digit code"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
                <Button type="submit" variant="primary" disabled={busy}>
                  Confirm
                </Button>
              </form>
            </div>
          )}

          {user?.mfa_enabled && (
            <form className="mt-4 flex items-end gap-3" onSubmit={disableMfa}>
              <Field
                label="Enter a code to disable"
                inputMode="numeric"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              <Button type="submit" variant="secondary" disabled={busy}>
                Disable MFA
              </Button>
            </form>
          )}
        </Card>
      </div>
    </main>
  );
}

export default function AccountPage() {
  return (
    <AuthGuard>
      <AccountContent />
    </AuthGuard>
  );
}
