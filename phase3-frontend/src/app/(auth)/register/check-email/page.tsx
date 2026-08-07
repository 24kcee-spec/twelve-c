"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/types";
import { Button, Card, ErrorNote, Logo } from "@/components/ui";

const CODE_LENGTH = 6;

function CheckEmailContent() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") ?? "";

  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  function setDigit(index: number, raw: string) {
    const value = raw.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    if (value && index < CODE_LENGTH - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  }

  function onKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!pasted) return;
    e.preventDefault();
    const next = Array(CODE_LENGTH).fill("");
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    inputsRef.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = digits.join("");
    if (!email || code.length !== CODE_LENGTH) {
      setError("Enter the full 6-digit code.");
      return;
    }
    setError("");
    setVerifying(true);
    try {
      await api.verifyEmail(email, code);
      router.push("/login?verified=1");
    } catch (err) {
      setDigits(Array(CODE_LENGTH).fill(""));
      inputsRef.current[0]?.focus();
      if (err instanceof ApiError) {
        setError(typeof err.detail === "string" ? err.detail : "That code didn't work. Try again.");
      } else {
        setError("That code didn't work. Try again.");
      }
    } finally {
      setVerifying(false);
    }
  }

  async function resend() {
    if (!email) return;
    setResendStatus("sending");
    try {
      await api.resendVerification(email);
      setResendStatus("sent");
    } catch {
      setResendStatus("error");
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
            {email ? (
              <>
                We&apos;ve sent a 6-digit code to <span className="font-medium text-ink">{email}</span>. Enter it
                below to activate your account.
              </>
            ) : (
              "We've sent a 6-digit code to your email. Enter it below to activate your account."
            )}
          </p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div className="flex justify-between gap-2" onPaste={onPaste}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputsRef.current[i] = el;
                  }}
                  inputMode="numeric"
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  maxLength={1}
                  value={d}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => onKeyDown(i, e)}
                  className="h-12 w-11 rounded border border-line bg-surface text-center font-mono text-lg text-ink outline-none transition focus:border-usd"
                />
              ))}
            </div>

            <ErrorNote>{error}</ErrorNote>

            <Button type="submit" variant="primary" className="w-full" disabled={verifying}>
              {verifying ? "Verifying…" : "Verify email"}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm text-ink-soft">
            Didn&apos;t get it?{" "}
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
          {resendStatus === "error" && (
            <p className="mt-2 text-center text-sm text-danger">Something went wrong. Try again in a moment.</p>
          )}

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