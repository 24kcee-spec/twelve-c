"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/types";
import { Button, Card, ErrorNote, Field, Logo } from "@/components/ui";
import GoogleSignInButton from "@/components/GoogleSignInButton";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justVerified = searchParams.get("verified") === "1";
  const { login, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [loading, setLoading] = useState(false);

  const errorMessage = (err: unknown, fallback: string) => {
    if (err instanceof ApiError) {
      if (typeof err.detail === "string") return err.detail;
      if (Array.isArray(err.detail)) return err.detail.map((d: { msg?: string }) => d.msg).join(" ");
    }
    return fallback;
  };

  const goAfterAuth = (mfaRequired: boolean) => {
    router.push(mfaRequired ? "/mfa" : "/dashboard");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setLoading(true);

    try {
      const { mfaRequired } = await login(email, password);
      goAfterAuth(mfaRequired);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setNeedsVerification(true);
      }
      setError(errorMessage(err, "Failed to log in."));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credential: string) => {
    setError(null);
    setLoading(true);
    try {
      const { mfaRequired } = await loginWithGoogle(credential);
      goAfterAuth(mfaRequired);
    } catch (err) {
      setError(errorMessage(err, "Google Sign-In failed on server."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card>
          <h1 className="font-display text-2xl text-ink">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-soft">Log in to your businesses.</p>

          {justVerified && !error && (
            <div className="mt-4 rounded border border-usd/30 bg-usd-soft px-3 py-2 text-sm text-usd">
              Email verified. You can log in now.
            </div>
          )}

          <div className="mt-6">
            <GoogleSignInButton
              onSuccess={handleGoogleSuccess}
              onError={() => setError("Google Sign-In failed to connect.")}
            />
          </div>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-line" />
            <span className="font-mono text-xs uppercase tracking-[0.15em] text-ink-faint">or</span>
            <div className="h-px flex-1 bg-line" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
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

            <ErrorNote>
              {error && (
                <>
                  {error}
                  {needsVerification && (
                    <>
                      {" "}
                      <Link
                        href={`/register/check-email?email=${encodeURIComponent(email)}`}
                        className="font-medium underline"
                      >
                        Enter your verification code
                      </Link>
                    </>
                  )}
                </>
              )}
            </ErrorNote>

            <Button type="submit" variant="primary" className="w-full" disabled={loading}>
              {loading ? "Logging in…" : "Log in"}
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

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
