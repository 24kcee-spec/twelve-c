import Link from "next/link";
import { QuarterlyRhythm } from "@/components/QuarterlyRhythm";
import { Button, Card, Eyebrow, Logo } from "@/components/ui";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <nav className="flex items-center gap-6">
          <Link href="/login" className="text-sm text-ink-soft hover:text-ink">
            Log in
          </Link>
          <Link href="/register">
            <Button variant="primary">Get started</Button>
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-6 pb-24 pt-8 md:grid-cols-2 md:gap-8">
        <div className="flex flex-col justify-center">
          <h1 className="font-display text-4xl leading-[1.05] text-ink md:text-5xl">
            Your provisional tax isn&apos;t due in four equal chunks.
          </h1>
          <p className="mt-5 max-w-md text-ink-soft">
            ZIMRA&apos;s QPD schedule front-loads almost nothing and back-loads
            65% of the year&apos;s tax into September and December. Twelve C
            calculates the split correctly — across USD and ZIG, with the
            Public Notice 71 capping rule applied properly — so the number
            you see is the number you owe.
          </p>
          <div className="mt-8 flex gap-3">
            <Link href="/register">
              <Button variant="primary">Calculate your QPD</Button>
            </Link>
            <Link href="/login">
              <Button variant="secondary">I already have an account</Button>
            </Link>
          </div>
        </div>

        <div className="flex flex-col justify-center">
          <Card>
            <Eyebrow>The actual schedule</Eyebrow>
            <div className="mt-4">
              <QuarterlyRhythm />
            </div>
            <p className="mt-4 text-sm text-ink-faint">
              10 / 25 / 30 / 35 — most businesses only notice how uneven this
              is when Q3 arrives and the bill is triple what Q1 was.
            </p>
          </Card>
        </div>
      </section>

      <section className="border-t border-line bg-surface py-20">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 md:grid-cols-3">
          <Feature
            icon={<CurrencyIcon />}
            eyebrow="01 · Dual currency"
            title="USD and ZIG, one calculation"
            body="Enter sales and expenses in whichever currency they actually traded in. Twelve C applies the Public Notice 71 50/50 cap correctly — only when USD is the dominant currency, uncapped when ZIG dominates — instead of guessing."
          />
          <Feature
            icon={<CalendarIcon />}
            eyebrow="02 · Built for the deadline"
            title="A schedule you can act on"
            body="25 March, 25 June, 25 September, 20 December. Each instalment shows what's owed, what's paid, and what's still outstanding — no dead cell references, no silent zeroes."
          />
          <Feature
            icon={<BuildingsIcon />}
            eyebrow="03 · One business or several"
            title="Every entity, one login"
            body="Run more than one business through the same account, each with its own exchange rate and rate defaults, each calculation kept on record for when ZIMRA asks how you got the number."
          />
        </div>
      </section>

      <footer className="border-t border-line px-6 py-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs text-ink-faint">
            Twelve C is an independent calculator and is not affiliated with
            the Zimbabwe Revenue Authority. Verify figures before filing.
          </p>
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-ink-soft">
            <Link href="/legal/disclaimer" className="hover:text-ink">Disclaimer</Link>
            <Link href="/legal/privacy-policy" className="hover:text-ink">Privacy Policy</Link>
            <Link href="/legal/terms-of-service" className="hover:text-ink">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Feature({
  icon,
  eyebrow,
  title,
  body,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="border-t-2 border-ink pt-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-usd-soft text-usd">
        {icon}
      </div>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h3 className="mt-2 font-display text-xl text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
    </div>
  );
}

function CurrencyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h13l-3.5-3.5" />
      <path d="M4 7l3.5 3.5" />
      <path d="M20 17H7l3.5-3.5" />
      <path d="M20 17l-3.5 3.5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="15" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BuildingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="6" height="10" />
      <rect x="14" y="4" width="6" height="16" />
      <path d="M6.5 13h1M6.5 16h1M16.5 7h1M16.5 10h1M16.5 13h1M16.5 16h1" />
    </svg>
  );
}