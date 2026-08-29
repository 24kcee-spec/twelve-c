"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatedScheduleReveal } from "@/components/AnimatedScheduleReveal";
import { QuarterlyRhythm } from "@/components/QuarterlyRhythm";
import { Button, Card, Eyebrow, Logo } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

const FEATURES: { title: string; body: string }[] = [
  {
    title: "The cumulative method, not a shortcut",
    body: "Each instalment is the required percentage of your current best estimate, minus what's confirmed paid so far — the way ZIMRA's Public Notice actually defines QPD, not a flat quarterly split.",
  },
  {
    title: "USD and ZiG, side by side",
    body: "Enter sales and expenses in either currency and see both balances at once, so a mixed-currency business never has to convert by hand before it can file.",
  },
  {
    title: "Capital allowances built in",
    body: "Add assets to a register once and their wear-and-tear and SIA allowances feed straight into the estimate — no separate spreadsheet to keep in sync.",
  },
  {
    title: "A schedule you can hand to your accountant",
    body: "Every calculation exports as a clean PDF summary, and payments you've confirmed carry forward automatically into the next quarter's numbers.",
  },
];

const STEPS = [
  { n: "01", title: "Add a business", body: "Your entity's exchange rate, corporate tax rate, and AIDS levy rate — set once, editable per calculation." },
  { n: "02", title: "Enter this quarter", body: "USD and ZiG sales and expenses. Twelve C works out the cumulative instalment ZIMRA expects." },
  { n: "03", title: "Confirm and file", body: "Download the PDF summary, pay ZIMRA, then confirm what actually went through so next quarter nets correctly." },
];

function LandingHeader() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="hidden items-center gap-6 md:flex">
          <Link href="/learn" className="text-sm text-ink-soft transition hover:text-ink">
            Know your taxes
          </Link>
          <Link href="/tutorial" className="text-sm text-ink-soft transition hover:text-ink">
            Tutorial
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-ink-soft transition hover:text-ink">
            Log in
          </Link>
          <Link href="/register">
            <Button variant="primary">Get started</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-4 px-6 py-8 text-sm text-ink-faint md:flex-row md:items-center">
        <Logo className="text-base" />
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/legal/disclaimer" className="transition hover:text-ink">
            Disclaimer
          </Link>
          <Link href="/legal/privacy-policy" className="transition hover:text-ink">
            Privacy
          </Link>
          <Link href="/legal/terms-of-service" className="transition hover:text-ink">
            Terms
          </Link>
        </div>
        <span>Named for the ITF12C form it replaces.</span>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Signed-in visitors shouldn't land on the pitch - send them straight
  // into the app. Unauthenticated visitors (and the brief moment while the
  // silent refresh-cookie check is still running) see the marketing page.
  useEffect(() => {
    if (!loading && user) {
      router.replace("/dashboard");
    }
  }, [loading, user, router]);

  if (loading || user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <span className="font-mono text-sm text-ink-faint">Loading…</span>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-paper">
      <LandingHeader />

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-16 md:pb-24 md:pt-24">
        <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-2">
          <div>
            <Eyebrow>ZIMRA provisional tax, calculated properly</Eyebrow>
            <h1 className="mt-3 font-display text-4xl leading-[1.1] text-ink md:text-5xl">
              QPD tax, without the spreadsheet.
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-ink-soft">
              Twelve C calculates your ZIMRA Quarterly Payment Date instalments the way
              the law actually requires — cumulative, not flat — across USD and ZiG,
              so you can file with confidence instead of guesswork.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href="/register">
                <Button variant="primary" className="px-6 py-3 text-base">
                  Get started free
                </Button>
              </Link>
              <Link href="/learn">
                <Button variant="ghost" className="px-6 py-3 text-base">
                  Know your taxes first &rarr;
                </Button>
              </Link>
            </div>
            <p className="mt-6 font-mono text-xs uppercase tracking-[0.15em] text-ink-faint">
              Built for Zimbabwean sole traders, PBCs, and private companies
            </p>
          </div>
          <div className="fade-in-up">
            <AnimatedScheduleReveal />
          </div>
        </div>
      </section>

      {/* The cumulative rhythm, visualised */}
      <section className="border-y border-line bg-surface/50">
        <div className="mx-auto max-w-5xl px-6 py-14">
          <Eyebrow>How the year is structured</Eyebrow>
          <h2 className="mt-2 font-display text-2xl text-ink md:text-3xl">
            10% · 25% · 30% · 35% of your best estimate
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
            Each QPD instalment is a cumulative share of your current estimate for the
            full tax year, minus whatever you've already confirmed paid. Twelve C
            recalculates that estimate every quarter as your actual numbers come in.
          </p>
          <div className="mt-8">
            <QuarterlyRhythm />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 py-16 md:py-24">
        <Eyebrow>What you get</Eyebrow>
        <h2 className="mt-2 font-display text-2xl text-ink md:text-3xl">
          Everything the calculation needs, in one place
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <h3 className="font-display text-lg text-ink">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-line bg-surface/50">
        <div className="mx-auto max-w-5xl px-6 py-16 md:py-24">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-2 font-display text-2xl text-ink md:text-3xl">
            Three steps, every quarter
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n}>
                <span className="font-display text-3xl text-usd">{s.n}</span>
                <h3 className="mt-2 font-display text-lg text-ink">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-5xl px-6 py-16 text-center md:py-24">
        <h2 className="font-display text-3xl text-ink md:text-4xl">
          Get your next QPD right the first time.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-ink-soft">
          Free to use. No card required to calculate your first instalment.
        </p>
        <Link href="/register" className="mt-8 inline-block">
          <Button variant="primary" className="px-8 py-3 text-base">
            Create your free account
          </Button>
        </Link>
      </section>

      <LandingFooter />
    </main>
  );
}