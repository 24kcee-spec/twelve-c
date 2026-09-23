import Link from "next/link";
import { Button, Card, Eyebrow, Logo } from "@/components/ui";

const STEPS = [
  {
    n: "01",
    title: "Add your business",
    body: "Give it a name, and set your default exchange rate, corporate tax rate, and AIDS levy rate once. Twelve C remembers them, so you don't retype the same numbers every quarter. Why it matters: ZIMRA's QPD formula needs these three numbers for every single calculation, and getting them wrong once means every quarter downstream is wrong too — setting them here, correctly, at the start avoids that. You can run more than one business under a single login, and rates can always be overridden for a one-off recalculation without touching the saved defaults.",
  },
  {
    n: "02",
    title: "Build up income month by month",
    body: "Rather than guessing a full-year figure upfront, enter actual sales for each month that's closed and one estimate for the month still in progress. Twelve C annualizes it automatically, and you can add a buffer percentage for caution or a one-off adjustment for something like an asset sale. Why it matters: this is exactly how ZIMRA expects a provisional estimate to be built — a rolling, evidence-based projection, not a guess pulled from thin air — and it's also what keeps your figures defensible if ZIMRA ever asks how you arrived at them. This carries forward as the year progresses, so QPD2 already remembers what you entered for QPD1 and simply replaces March's estimate with the real figure once it's known.",
  },
  {
    n: "03",
    title: "Add deductions and capital assets",
    body: "Enter cost of sales, salaries, and other expenses in whichever currency they actually happened in — don't convert them yourself first. Capital assets go into a register once; Twelve C works out the wear-and-tear or Special Initial Allowance and feeds it into this year's capital allowances automatically, and the same asset carries into next year on its own. Why it matters: taxable profit is income minus these deductions, so an expense entered in the wrong currency (or a missed capital allowance) understates or overstates your tax directly — this step is where most of the real accuracy of a QPD estimate comes from.",
  },
  {
    n: "04",
    title: "Understand your currency split",
    body: "Twelve C works out what share of your trade was USD versus ZiG, and keeps the two currencies as separate totals throughout — nothing is ever converted or netted between them, because ZIMRA's rules (Section 37AA) require each currency's tax to be assessed on its own. There's one rule worth knowing: if USD is your dominant trading currency, Public Notice 71 caps the payment split at an even 50/50 rather than the raw percentage; if ZiG is dominant, the real ratio is used instead. Twelve C applies whichever branch fires automatically and shows you which one it used.",
  },
  {
    n: "05",
    title: "Read your QPD schedule",
    body: "ZIMRA's provisional tax isn't four equal chunks — it's a running cumulative target: 10% of your annual estimate by 25 March, 35% by 25 June, 65% by 25 September, and 100% by 20 December. Each instalment due is that quarter's cumulative target minus what you've already confirmed paying, so a revised estimate mid-year (say, if trade picks up) adjusts the remaining instalments upward without throwing off what's already settled — you never end up owing for a quarter that's already closed.",
  },
  {
    n: "06",
    title: "Confirm what you actually paid",
    body: "Each quarter's Payments tab shows that quarter's own due date and the amount required, and lets you confirm what you actually paid in USD and ZiG. Why only the current quarter, and not a big table of four: a QPD due date is a single event, and what you paid against it is a single fact — Twelve C automatically carries that confirmed figure forward, so the NEXT quarter's \"less: paid at earlier QPDs\" line is built from what you genuinely paid, not from what was merely calculated. A short payment doesn't vanish — it simply raises the following quarter's net payable to catch up.",
  },
  {
    n: "07",
    title: "See where you stand for the year",
    body: "The Reconciliation tab lays out all four quarters side by side — due date, cumulative target, what you've confirmed paying, and what's still owed — so you can see at a glance whether a quarter is settled, outstanding, or not yet calculated. Quarters that haven't been run yet for the selected tax year show up greyed out rather than as a false zero.",
  },
  {
    n: "08",
    title: "Export your working papers",
    body: "From the Reconciliation tab, download the whole tax year as a Working Papers Excel workbook or PDF. The Excel version isn't a snapshot of numbers — the currency split, deductions, taxable profit, tax, and what-to-pay steps are LIVE Excel formulas reading off an Inputs sheet, so you (or your accountant) can open it, change a figure, and watch the rest recalculate; useful for a what-if check or for showing exactly how a number was derived, cell by cell. The PDF is the same working papers laid out as a clean, printable document. Why both exist: an accountant or auditor working from a spreadsheet wants the live formulas; anyone who just needs a record to file or hand over wants the PDF.",
  },
  {
    n: "09",
    title: "Never miss a date, and keep your records",
    body: "Every business page shows a banner telling you exactly what's due next and how many days you have, and anything overdue surfaces at the top of your dashboard too. Every calculation is saved to that business's history by tax year and quarter, and can be downloaded on its own as a one-quarter PDF summary — a timestamped record of exactly what numbers and rates were used for that specific run, in addition to the full-year Working Papers export above.",
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
