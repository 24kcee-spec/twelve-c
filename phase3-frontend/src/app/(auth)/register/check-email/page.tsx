"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, ErrorNote, Field, Logo } from "@/components/ui";

function CheckEmailContent() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function resend() {
    if (!email) return;
    setStatus("sending");
    try {
      await api.resendVerification(email);
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card>
          <h1 className="font-display text-2xl text-ink">Check your email</h1>
          <p className="mt-2 text-sm text-ink-soft">
            We&apos;ve sent a verification link to your inbox. Click it to activate your account, then
            come back and log in. Links expire after 24 hours.
          </p>

          <div className="mt-6 space-y-3">
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button
              variant="secondary"
              className="w-full"
              onClick={resend}
              disabled={status === "sending" || !email}
            >
              {status === "sending" ? "Sending…" : "Resend the email"}
            </Button>
            {status === "sent" && (
              <p className="text-center text-sm text-usd">Sent! Check your inbox (and spam folder).</p>
            )}
            {status === "error" && <ErrorNote>Something went wrong. Try again in a moment.</ErrorNote>}
          </div>

          <p className="mt-6 text-center text-sm text-ink-soft">
            Already verified?{" "}
            <Link href="/login" className="font-medium text-usd">
              Log in
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense fallback={null}>
      <CheckEmailContent />
    </Suspense>
  );
}
