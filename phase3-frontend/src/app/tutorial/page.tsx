import Link from "next/link";
import { Button, Card, Eyebrow, Logo } from "@/components/ui";

const STEPS = [
  {
    n: "01",
    title: "Add your business",
    body: "Give it a name, and set your default exchange rate, corporate tax rate, and AIDS levy rate once. Twelve C remembers them, so you don't retype the same numbers every quarter. You can run more than one business under a single login.",
  },
  {
    n: "02",
    title: "Enter what you actually earned and spent",
    body: "For the period you're calculating, enter USD and ZiG sales, plus deductions (cost of sales, salaries, other expenses, capital allowances) in whichever currency they actually happened in. No conversion required on your end — Twelve C handles that.",
  },
  {
    n: "03",
    title: "Understand your currency split",
    body: "Twelve C works out what share of your trade was USD versus ZiG. There's one rule worth knowing: Public Notice 71 says if USD is your dominant currency, the payment split is capped at an even 50/50 rather than the raw percentage — Twelve C applies this automatically and shows you the before-and-after so you can see exactly what changed and why.",
  },
  {
    n: "04",
    title: "Read your QPD schedule",
    body: "ZIMRA doesn't split provisional tax into four equal chunks. It's 10% by 25 March, 25% by 25 June, 30% by 25 September, and 35% by 20 December — most of the year's bill lands in the second half. The schedule wheel shows you all four instalments, what's owed, and which one is coming up next.",
  },
  {
    n: "05",
    title: "Track what you've actually paid",
    body: "As you pay ZIMRA, record it against each instalment. Twelve C tells you in plain language whether you still owe something, you've paid in full, or you've overpaid — no confusing negative numbers to interpret.",
  },
  {
    n: "06",
    title: "Never miss a date",
    body: "Every business page shows a banner telling you exactly what's due next and how many days you have. If anything across any of your businesses is overdue, it also shows up right at the top of your dashboard — so you never have to check each business separately to find out.",
  },
  {
    n: "07",
    title: "Keep your records",
    body: "Every calculation you run is saved to that business's history, grouped by tax year, so you always have a timestamped record of exactly what numbers and rates were used — useful if ZIMRA or your accountant ever asks how you arrived at a figure.",
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
          it does, step by step, in the order you'll actually use it.
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