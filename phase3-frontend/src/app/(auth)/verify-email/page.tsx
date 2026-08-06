"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/types";
import { Button, Card, ErrorNote, Logo } from "@/components/ui";

function VerifyEmailContent() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [status, setStatus] = useState<"checking" | "success" | "error">("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("This link is missing its verification code.");
      return;
    }
    api
      .verifyEmail(token)
      .then(() => setStatus("success"))
      .catch((err) => {
        setStatus("error");
        setMessage(
          err instanceof ApiError && typeof err.detail === "string"
            ? err.detail
            : "This link is invalid or has expired."
        );
      });
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card>
          {status === "checking" && (
            <>
              <h1 className="font-display text-2xl text-ink">Verifying…</h1>
              <p className="mt-2 text-sm text-ink-soft">One moment.</p>
            </>
          )}

          {status === "success" && (
            <>
              <h1 className="font-display text-2xl text-ink">Email verified</h1>
              <p className="mt-2 text-sm text-ink-soft">Your account is active. You can log in now.</p>
              <Link href="/login">
                <Button variant="primary" className="mt-6 w-full">
                  Go to login
                </Button>
              </Link>
            </>
          )}

          {status === "error" && (
            <>
              <h1 className="font-display text-2xl text-ink">Couldn&apos;t verify</h1>
              <div className="mt-2">
                <ErrorNote>{message}</ErrorNote>
              </div>
              <p className="mt-4 text-center text-sm text-ink-soft">
                <Link href="/register/check-email" className="font-medium text-usd">
                  Resend verification email
                </Link>
              </p>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}
