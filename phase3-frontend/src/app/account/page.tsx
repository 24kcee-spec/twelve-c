"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { Button, Card, ErrorNote, Eyebrow, Field } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { ApiError, MfaSetupResponse } from "@/lib/types";

function AccountContent() {
  const { user, refreshUser, logout } = useAuth();
  const router = useRouter();
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);

  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteTotp, setDeleteTotp] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

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

  async function confirmDelete(e: React.FormEvent) {
    e.preventDefault();
    setDeleteError("");

    if (deleteConfirmText.trim().toUpperCase() !== "DELETE") {
      setDeleteError('Type "DELETE" in the box below to confirm.');
      return;
    }

    setDeleting(true);
    try {
      await api.deleteAccount({
        password: user?.has_password ? deletePassword : undefined,
        totp_code: user?.mfa_enabled ? deleteTotp : undefined,
      });
      await logout();
      router.push("/");
    } catch (err) {
      setDeleteError(err instanceof ApiError && typeof err.detail === "string" ? err.detail : "Couldn't delete your account. Check the details and try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper">
      <TopBar />
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Eyebrow>Account</Eyebrow>
        <h1 className="mt-1 font-display text-3xl text-ink">{user?.email}</h1>

        <Card className="mt-8">
          <Eyebrow>Rate settings &amp; appearance</Eyebrow>
          <p className="mt-1 text-sm text-ink-soft">
            Exchange rate, tax rate, AIDS levy rate, and light/dark mode have
            moved into the account menu for quicker access — click your
            initials in the top bar, then <strong className="text-ink">Rate settings</strong> or{" "}
            <strong className="text-ink">Appearance</strong>.
          </p>
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
              <div>
                <p className="text-xs text-ink-faint">Can&apos;t scan? Enter this key manually:</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="flex-1 break-all rounded border border-line bg-surface px-3 py-2 font-mono text-sm tracking-wider text-ink">
                    {setup.secret.match(/.{1,4}/g)?.join(" ") ?? setup.secret}
                  </code>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(setup.secret);
                      setSecretCopied(true);
                      setTimeout(() => setSecretCopied(false), 2000);
                    }}
                    className="shrink-0 rounded border border-line px-3 py-2 text-xs font-semibold text-ink-soft transition hover:border-usd hover:text-usd"
                  >
                    {secretCopied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
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

        <Card className="mt-6 border-danger/40">
          <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-danger">
            <span className="h-1 w-1 rounded-full bg-danger" />
            Danger zone
          </span>
          <p className="mt-1 text-sm text-ink-soft">
            Permanently delete your account, every business you&apos;ve added, and all saved
            calculations. This cannot be undone.
          </p>

          {!showDelete && (
            <Button
              variant="secondary"
              className="mt-4 border-danger/50 text-danger hover:border-danger hover:bg-danger hover:text-paper hover:shadow-[0_0_24px_rgba(220,38,38,0.35)]"
              onClick={() => setShowDelete(true)}
            >
              Delete my account
            </Button>
          )}

          {showDelete && (
            <form className="mt-4 space-y-4" onSubmit={confirmDelete}>
              {user?.has_password && (
                <Field
                  label="Confirm your password"
                  type="password"
                  required
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                />
              )}

              {user?.mfa_enabled && (
                <Field
                  label="6-digit authentication code"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={deleteTotp}
                  onChange={(e) => setDeleteTotp(e.target.value.replace(/\D/g, ""))}
                />
              )}

              <Field
                label='Type "DELETE" to confirm'
                required
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
              />

              <ErrorNote>{deleteError}</ErrorNote>

              <div className="flex gap-3">
                <Button
                  type="submit"
                  variant="secondary"
                  className="border-danger bg-danger text-paper shadow-[0_0_20px_rgba(220,38,38,0.4)] hover:bg-danger hover:text-paper"
                  disabled={deleting}
                >
                  {deleting ? "Deleting…" : "Permanently delete my account"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowDelete(false);
                    setDeletePassword("");
                    setDeleteTotp("");
                    setDeleteConfirmText("");
                    setDeleteError("");
                  }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
              </div>
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