import Link from "next/link";
import { Button, Card, Eyebrow, Logo } from "@/components/ui";

const STEPS = [
  {
    n: "01",
    title: "Add your business",
    body: "Give it a name, and set your default exchange rate, corporate tax rate, and AIDS levy rate once. Twelve C remembers them, so you don't retype the same numbers every quarter. You can run more than one business under a single login, and rates can always be overridden for a one-off recalculation without touching the saved defaults.",
  },
  {
    n: "02",
    title: "Build up income month by month",
    body: "Rather than guessing a full-year figure upfront, enter actual sales for each month that's closed and one estimate for the month still in progress. Twelve C annualizes it automatically, and you can add a buffer percentage for caution or a one-off adjustment for something like an asset sale. This carries forward as the year progresses, so QPD2 already remembers what you entered for QPD1.",
  },
  {
    n: "03",
    title: "Add deductions and capital assets",
    body: "Enter cost of sales, salaries, and other expenses in whichever currency they happened in. Capital assets go into a register once — Twelve C works out the wear-and-tear or Special Initial Allowance and feeds it into this year's capital allowances for you, and the same asset carries into next year automatically.",
  },
  {
    n: "04",
    title: "Understand your currency split",
    body: "Twelve C works out what share of your trade was USD versus ZiG, and keeps the two currencies as separate totals throughout — nothing is converted or netted between them. There's one rule worth knowing: if USD is your dominant currency, Public Notice 71 caps the payment split at an even 50/50 rather than the raw percentage. Twelve C applies this automatically.",
  },
  {
    n: "05",
    title: "Read your QPD schedule",
    body: "ZIMRA's provisional tax isn't four equal chunks — it's a running cumulative target: 10% of your annual estimate by 25 March, 35% by 25 June, 65% by 25 September, and 100% by 20 December. Each instalment due is that quarter's cumulative target minus what you've already confirmed paying, so a revised estimate mid-year adjusts the remaining instalments rather than throwing off what's already settled.",
  },
  {
    n: "06",
    title: "Track what you've actually paid",
    body: "As you pay ZIMRA, record it against each instalment. Twelve C tells you in plain language whether you still owe something, you've paid in full, or you've overpaid — no confusing negative numbers to interpret.",
  },
  {
    n: "07",
    title: "See where you stand for the year",
    body: "The reconciliation view lays out all four quarters side by side — due date, cumulative target, what you've confirmed paying, and what's still owed — so you can see at a glance whether a quarter is settled, outstanding, or not yet calculated.",
  },
  {
    n: "08",
    title: "Never miss a date, and keep your records",
    body: "Every business page shows a banner telling you exactly what's due next and how many days you have, and anything overdue surfaces at the top of your dashboard too. Every calculation is saved to that business's history by tax year and can be downloaded as a clean PDF summary — a timestamped record of exactly what numbers and rates were used, ready to hand to your accountant or produce for ZIMRA.",
  },
];

export default function TutorialPage() {
  return (
    <main className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/">
          <Logo />
        </Link>
        <Link href="/dashboard" className="text-sm text-ink-soft hover:text-ink">
          Back to dashboard
        </Link>
      </header>

      <div className="mx-auto max-w-3xl px-6 pb-24">
        <Eyebrow>How it works</Eyebrow>
        <h1 className="mt-2 font-display text-3xl text-ink">
          Twelve C, explained in plain language
        </h1>
        <p className="mt-3 max-w-xl text-sm text-ink-soft">
          You don't need to be an accountant to use this. Here's everything
          it does, step by step, in the order you'll actually use it — the
          rates and rules behind every number are checked against ZIMRA's
          own published figures.
        </p>

        <div className="mt-10 space-y-4">
          {STEPS.map((step) => (
            <Card key={step.n}>
              <div className="flex gap-4">
                <span className="font-mono text-xs text-ink-faint">{step.n}</span>
                <div>
                  <h2 className="font-display text-lg text-ink">{step.title}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{step.body}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="mt-10 rounded-md border border-usd/30 bg-usd-soft p-5 text-center">
          <p className="text-sm text-ink-soft">Ready to see it with your own numbers?</p>
          <Link href="/register" className="mt-3 inline-block">
            <Button variant="primary">Get started</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
