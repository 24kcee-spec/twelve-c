"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/types";
import { Button, Card, ErrorNote, Field, Logo } from "@/components/ui";

export default function MfaChallengePage() {
  const router = useRouter();
  const { completeMfaLogin } = useAuth();
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const token = window.sessionStorage.getItem("twelvec_mfa_pending");
    if (!token) {
      router.replace("/login");
      return;
    }
    setPendingToken(token);
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingToken) return;
    setError("");
    setSubmitting(true);
    try {
      await completeMfaLogin(pendingToken, code);
      window.sessionStorage.removeItem("twelvec_mfa_pending");
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError && typeof err.detail === "string" ? err.detail : "Invalid code");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card>
          <h1 className="font-display text-2xl text-ink">Enter your code</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Open your authenticator app and enter the 6-digit code for this account.
          </p>
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <Field
              label="Authentication code"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" variant="primary" className="w-full" disabled={submitting || !pendingToken}>
              {submitting ? "Verifying…" : "Verify and log in"}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
