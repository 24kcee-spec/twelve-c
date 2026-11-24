"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Logo } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

export default function StudyPage() {
  const { user, loading, studyError, startStudySession } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user?.is_study_guest) {
      router.replace("/dashboard");
    }
  }, [loading, user, router]);

  return (
    <main className="flex min-h-screen flex-col bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Logo />
          <Link href="/" className="text-sm text-ink-soft transition hover:text-ink">
            Back to Twelve C
          </Link>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-usd">
          Twelve C · Research access
        </p>
        <h1 className="mt-3 font-display text-3xl text-ink sm:text-4xl">
          Opening your Twelve C study session
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          No registration, email address or password is required. You will use the
          same Twelve C dashboard and features as a normal account. Businesses,
          calculations, payments and other study entries are saved through the
          Twelve C API for this anonymous session.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Use only the fictional information and figures supplied for the study.
          Do not enter real client, taxpayer or personal information.
        </p>

        {loading && (
          <div className="mt-8 flex items-center gap-3 text-sm text-ink-faint" role="status">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-usd" />
            Connecting to Twelve C…
          </div>
        )}

        {studyError && (
          <div className="mt-8 rounded-lg border border-danger/30 bg-danger-soft p-4">
            <p className="text-sm text-danger" role="alert">{studyError}</p>
            <Button variant="primary" className="mt-4" onClick={() => void startStudySession()}>
              Retry connection
            </Button>
          </div>
        )}
      </section>
      <footer className="border-t border-line px-6 py-5 text-center text-xs text-ink-faint">
        National University of Science and Technology · usability evaluation
      </footer>
    </main>
  );
}
