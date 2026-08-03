"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/types";
import { Button, Card, ErrorNote, Field, Logo } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.mfaRequired && result.pendingToken) {
        window.sessionStorage.setItem("twelvec_mfa_pending", result.pendingToken);
        router.push("/mfa");
      } else {
        router.push("/dashboard");
      }
    } catch (err) {
      setError(err instanceof ApiError && typeof err.detail === "string" ? err.detail : "Login failed");
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
          <h1 className="font-display text-2xl text-ink">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-soft">Log in to your businesses.</p>
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <Field
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              label="Password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
              {submitting ? "Logging in…" : "Log in"}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-ink-soft">
            Need an account?{" "}
            <Link href="/register" className="font-medium text-usd">
              Create one
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}
