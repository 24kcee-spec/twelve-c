"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/types";
import { Button, Card, ErrorNote, Field, Logo } from "@/components/ui";

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const initialEmail = params.get("email") ?? "";

  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent">("idle");

  const errorMessage = (err: unknown, fallback: string) => {
    if (err instanceof ApiError) {
      if (typeof err.detail === "string") return err.detail;
      if (Array.isArray(err.detail)) return err.detail.map((d: { msg?: string }) => d.msg).join(" ");
    }
    return fallback;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      await api.resetPassword(email, code.trim(), newPassword);
      router.push("/login?reset=1");
    } catch (err) {
      setError(errorMessage(err, "That code didn't work. Try again."));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (!email) return;
    setResendStatus("sending");
    try {
      await api.forgotPassword(email);
      setResendStatus("sent");
    } catch {
      setResendStatus("sent");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card>
          <h1 className="font-display text-2xl text-ink">Reset your password</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Enter the 6-digit code we emailed you, along with your new password.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Field
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              label="6-digit code"
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Field
              label="New password"
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <Field
              label="Confirm new password"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />

            <ErrorNote>{error}</ErrorNote>

            <Button type="submit" variant="primary" className="w-full" disabled={loading}>
              {loading ? "Resetting…" : "Reset password"}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm text-ink-soft">
            Didn&apos;t get a code?{" "}
            <button
              type="button"
              onClick={resend}
              disabled={resendStatus === "sending" || !email}
              className="font-medium text-usd disabled:opacity-50"
            >
              {resendStatus === "sending" ? "Sending…" : "Resend code"}
            </button>
          </div>
          {resendStatus === "sent" && (
            <p className="mt-2 text-center text-sm text-usd">Sent! Check your inbox (and spam folder).</p>
          )}

          <p className="mt-6 text-center text-sm text-ink-soft">
            Remembered your password?{" "}
            <Link href="/login" className="font-medium text-usd">
              Log in
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}