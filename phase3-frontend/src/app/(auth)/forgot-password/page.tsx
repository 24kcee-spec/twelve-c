"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, ErrorNote, Field, Logo } from "@/components/ui";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.forgotPassword(email);
      router.push(`/reset-password?email=${encodeURIComponent(email)}`);
    } catch {
      // Backend always returns a generic success message for this endpoint,
      // so a thrown error here means something else went wrong (network etc).
      setError("Something went wrong. Please try again.");
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
          <h1 className="font-display text-2xl text-ink">Forgot your password?</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Enter your account email and we&apos;ll send you a 6-digit code to reset it.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Field
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <ErrorNote>{error}</ErrorNote>

            <Button type="submit" variant="primary" className="w-full" disabled={loading}>
              {loading ? "Sending…" : "Send reset code"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-ink-soft">
            Remembered it?{" "}
            <Link href="/login" className="font-medium text-usd">
              Log in
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}