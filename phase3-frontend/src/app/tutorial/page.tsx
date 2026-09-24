import Link from "next/link";
import { Badge, Button, Card, Disclosure, Eyebrow, Logo, SectionHeading } from "@/components/ui";

export const metadata = { title: "Documentation | Twelve C" };

const SECTIONS = [
  { id: "who", label: "Who must pay" },
  { id: "inputs", label: "What you enter" },
  { id: "method", label: "How it's calculated" },
  { id: "dates", label: "QPD dates" },
  { id: "example", label: "Worked example" },
  { id: "mistakes", label: "Common mistakes" },
  { id: "faq", label: "FAQ" },
];

const INPUTS = [
  {
    n: "01",
    title: "Business defaults",
    detail: "Exchange rate, corporate tax rate, and AIDS levy rate — set once, used on every calculation until overridden.",
  },
  {
    n: "02",
    title: "Monthly income",
    detail: "Actual sales for closed months plus an estimate for the month in progress, in USD and ZiG separately. Annualised automatically.",
  },
  {
    n: "03",
    title: "Deductions & capital assets",
    detail: "Cost of sales, salaries, other expenses, entered in whichever currency they occurred in. Capital assets feed automatic wear-and-tear.",
  },
  {
    n: "04",
    title: "Currency split",
    detail: "Computed, not entered — Twelve C works out the USD/ZiG trade ratio and applies the Public Notice 71 cap where it fires.",
  },
  {
    n: "05",
    title: "Confirmed payments",
    detail: "What you actually remitted to ZIMRA each quarter. Carries forward so the next quarter nets against reality, not the estimate.",
  },
];

const METHOD_STEPS = [
  {
    n: "01",
    title: "Currency ratio and the 50/50 cap",
    body: "Twelve C splits total trade into USD share and ZiG share. Section 37AA requires each currency's tax to be assessed on its own — nothing is netted between them.",
    why: "Public Notice 71: if USD is dominant, the payment ratio is capped at an even 50/50 rather than the raw percentage. If ZiG is dominant, the real ratio applies uncapped. Twelve C applies whichever branch fires and shows you which one it used.",
  },
  {
    n: "02",
    title: "Adjusted income and deductions",
    body: "Annual income and each deduction line are re-split by that payment ratio, in both currencies, to get an adjusted income and adjusted deduction figure per currency.",
    why: "This is the step most likely to be silently wrong in a manual spreadsheet — a currency conversion done in the wrong direction, or a deduction left un-split, changes the taxable profit directly.",
  },
  {
    n: "03",
    title: "Taxable profit, tax payable, AIDS levy",
    body: "Taxable profit = adjusted income − adjusted deductions (floored at zero). Tax payable = taxable profit × 25%. AIDS levy = tax payable × 3%.",
    why: "25.75% effective is the tax on tax payable, not on income directly — a common source of hand-calculation error.",
  },
  {
    n: "04",
    title: "Cumulative QPD schedule",
    body: "ZIMRA's provisional tax is a running cumulative target, not four equal chunks: 10% by 25 March, 35% by 25 June, 65% by 25 September, 100% by 20 December.",
    why: "Each instalment due is that quarter's cumulative target minus what you've already confirmed paying — so a mid-year revision adjusts only what's still ahead, never what's already settled.",
  },
];

const QPD_SCHEDULE = [
  { q: "QPD1", date: "25 March", cumulative: 0.1 },
  { q: "QPD2", date: "25 June", cumulative: 0.35 },
  { q: "QPD3", date: "25 September", cumulative: 0.65 },
  { q: "QPD4", date: "20 December", cumulative: 1.0 },
];

// Figures below match the verified fixture in phase1-engine's test suite
// (USD sales 12,000 / salaries 3,000 / other expenses 8,900 / rate 26.8),
// checked cell-for-cell against the source ITF12C workbook. Do not edit
// these without re-verifying against that fixture.
const EXAMPLE_ROWS = [
  { label: "USD sales (annual estimate)", usd: "12,000.00" },
  { label: "Salaries", usd: "3,000.00" },
  { label: "Other expenses", usd: "8,900.00" },
  { label: "Exchange rate", usd: "26.8 ZiG / USD" },
];
const EXAMPLE_RESULTS = [
  { label: "Trade currency split", usd: "100% USD", zig: "0% ZiG", note: "USD dominant \u2192 50/50 cap applies" },
  { label: "Adjusted income", usd: "6,000.00", zig: "160,800.00" },
  { label: "Adjusted deductions", usd: "5,950.00", zig: "159,460.00" },
  { label: "Taxable profit", usd: "50.00", zig: "1,340.00" },
  { label: "Tax payable (25%)", usd: "12.50", zig: "335.00" },
  { label: "AIDS levy (3% of tax)", usd: "0.375", zig: "10.05" },
  { label: "Total tax due", usd: "12.875", zig: "345.05" },
];
const EXAMPLE_SCHEDULE = [
  { q: "QPD1 \u00b7 25 Mar", pct: "10%", usd: "1.29", zig: "34.51" },
  { q: "QPD2 \u00b7 25 Jun", pct: "25%", usd: "3.22", zig: "86.26" },
  { q: "QPD3 \u00b7 25 Sep", pct: "30%", usd: "3.86", zig: "103.52" },
  { q: "QPD4 \u00b7 20 Dec", pct: "35%", usd: "4.51", zig: "120.77" },
];

const MISTAKES = [
  "Converting a ZiG figure to USD (or vice-versa) before entering it — enter each amount in the currency it actually occurred in and let the engine split it.",
  "Treating the 50/50 rule as always applying — it only fires when USD is the dominant trading currency; ZiG-dominant businesses use the real ratio.",
  "Reading the QPD percentages as four equal instalments instead of a cumulative target — QPD3's 30% is on top of the 35% already targeted by QPD2.",
  "Forgetting to confirm actual payments each quarter — the next quarter's instalment nets against what you confirmed, not against the original estimate.",
  "Leaving a capital asset out of the register — wear-and-tear only reaches taxable profit if the asset has been recorded.",
];

const FAQ = [
  {
    q: "Does Twelve C file anything with ZIMRA on my behalf?",
    a: "No. Twelve C calculates and records your QPD figures and produces working papers and PDF summaries for your own records or for your accountant — it does not submit anything to ZIMRA directly.",
  },
  {
    q: "What if my USD and ZiG trade shares are close to equal?",
    a: "The 50/50 cap only applies when USD trade share is strictly greater than ZiG trade share. If they're equal, or ZiG is greater, the actual ratio is used uncapped.",
  },
  {
    q: "Can I revise an earlier quarter's estimate?",
    a: "Yes — running a new calculation for a later quarter carries forward what you've already confirmed paying, so a revised annual estimate only changes what's still ahead, not instalments already settled.",
  },
  {
    q: "Where do the tax rate and AIDS levy figures come from?",
    a: "25% corporate tax and 3% AIDS levy on tax payable, verified against ZIMRA's published corporate tax rates. Both are configurable per business in case a future budget changes them.",
  },
  {
    q: "Can I run more than one business?",
    a: "Yes, under a single login, each with its own exchange rate, tax rate, and AIDS levy rate defaults.",
  },
];

export default function TutorialPage() {
  return (
    <main className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-4 py-6 sm:px-6">
        <Link href="/">
          <Logo />
        </Link>
        <Link href="/dashboard" className="text-sm text-ink-soft hover:text-ink">
          Back to dashboard
        </Link>
      </header>

      <div className="mx-auto max-w-4xl px-4 pb-24 sm:px-6">
        <Eyebrow>Documentation</Eyebrow>
        <h1 className="mt-2 font-display text-3xl text-ink sm:text-4xl">
          How Twelve C calculates your QPD
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
          A reference for how the numbers are derived — inputs, method, the
          statutory dates, and a fully worked example checked against
          ZIMRA&apos;s own ITF12C figures.
        </p>

        <nav aria-label="On this page" className="mt-8 flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-full border border-line px-3 py-1 font-mono text-xs text-ink-soft transition duration-150 hover:border-seal hover:text-ink"
            >
              {s.label}
            </a>
          ))}
        </nav>

        <section id="who" className="mt-12 scroll-mt-6">
          <SectionHeading n="01" title="Who must pay QPDs" />
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
            Every registered company, Private Business Corporation, and any
            individual with business or investment income outside formal
            employment is expected to self-assess and pay provisional tax in
            quarterly instalments, rather than one lump sum at year end.
          </p>
          <Card className="mt-4">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">Rate</dt>
                <dd className="mt-1 text-sm text-ink-soft">25% corporate tax + 3% AIDS levy — 25.75% effective</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">Currencies</dt>
                <dd className="mt-1 text-sm text-ink-soft">USD and ZiG, assessed and reported separately</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">Basis</dt>
                <dd className="mt-1 text-sm text-ink-soft">Self-assessed estimate, revised as the year progresses</dd>
              </div>
            </dl>
          </Card>
        </section>

        <section id="inputs" className="mt-12 scroll-mt-6">
          <SectionHeading n="02" title="What you enter" />
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
            Five inputs feed every calculation. Set the first once per
            business; the rest are entered or updated each quarter.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {INPUTS.map((item) => (
              <Card key={item.n}>
                <div className="flex gap-3">
                  <span className="font-mono text-xs text-ink-faint">{item.n}</span>
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-ink-soft">{item.detail}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        <section id="method" className="mt-12 scroll-mt-6">
          <SectionHeading n="03" title="How it's calculated" />
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
            Four steps, run in order, every time. Expand any step for the
            statutory reasoning behind it.
          </p>
          <div className="mt-4 divide-y divide-line rounded-md border border-line bg-surface shadow-card">
            {METHOD_STEPS.map((step) => (
              <div key={step.n} className="p-4">
                <div className="flex gap-3">
                  <span className="font-mono text-xs text-ink-faint">{step.n}</span>
                  <div className="w-full">
                    <h3 className="text-sm font-semibold text-ink">{step.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-soft">{step.body}</p>
                    <details className="group mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-usd [&::-webkit-details-marker]:hidden">
                        Why it matters
                      </summary>
                      <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">{step.why}</p>
                    </details>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="dates" className="mt-12 scroll-mt-6">
          <SectionHeading n="04" title="QPD dates" />
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
            A running cumulative target, not four equal chunks. Each
            instalment due is that quarter&apos;s target minus what you&apos;ve
            already confirmed paying.
          </p>
          <div className="mt-4 overflow-x-auto rounded-md border border-line bg-surface shadow-card">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">Instalment</th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">Due date</th>
                  <th className="px-4 py-3 text-right font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">Cumulative</th>
                </tr>
              </thead>
              <tbody>
                {QPD_SCHEDULE.map((row, i) => (
                  <tr key={row.q} className={i < QPD_SCHEDULE.length - 1 ? "border-b border-line" : ""}>
                    <td className="px-4 py-3 font-medium text-ink">{row.q}</td>
                    <td className="px-4 py-3 text-ink-soft">{row.date}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">
                      {(row.cumulative * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="example" className="mt-12 scroll-mt-6">
          <SectionHeading n="05" title="Worked example" />
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
            A complete calculation from raw inputs to the final schedule,
            checked cell-for-cell against the source ITF12C workbook.
          </p>

          <div className="letterhead mt-4 rounded-md border border-line bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <Eyebrow>Inputs</Eyebrow>
              <Badge variant="outline">Scenario A</Badge>
            </div>
            <table className="w-full border-collapse text-sm">
              <tbody>
                {EXAMPLE_ROWS.map((row, i) => (
                  <tr key={row.label} className={i < EXAMPLE_ROWS.length - 1 ? "border-b border-line" : ""}>
                    <td className="px-4 py-2.5 text-ink-soft">{row.label}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink">{row.usd}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="border-t border-line px-4 py-3">
              <Eyebrow>Result</Eyebrow>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">Line</th>
                    <th className="px-4 py-2 text-right font-mono text-[11px] uppercase tracking-[0.1em] text-usd">USD</th>
                    <th className="px-4 py-2 text-right font-mono text-[11px] uppercase tracking-[0.1em] text-zig">ZiG</th>
                  </tr>
                </thead>
                <tbody>
                  {EXAMPLE_RESULTS.map((row, i) => (
                    <tr
                      key={row.label}
                      className={`${i < EXAMPLE_RESULTS.length - 1 ? "border-b border-line" : ""} ${
                        row.label === "Total tax due" ? "font-semibold" : ""
                      }`}
                    >
                      <td className="px-4 py-2.5 text-ink-soft">
                        {row.label}
                        {row.note && <span className="ml-2 text-xs text-ink-faint">({row.note})</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink">{row.usd}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink">{row.zig}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-line px-4 py-3">
              <Eyebrow>Schedule</Eyebrow>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">Instalment</th>
                    <th className="px-4 py-2 text-right font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">%</th>
                    <th className="px-4 py-2 text-right font-mono text-[11px] uppercase tracking-[0.1em] text-usd">USD</th>
                    <th className="px-4 py-2 text-right font-mono text-[11px] uppercase tracking-[0.1em] text-zig">ZiG</th>
                  </tr>
                </thead>
                <tbody>
                  {EXAMPLE_SCHEDULE.map((row, i) => (
                    <tr key={row.q} className={i < EXAMPLE_SCHEDULE.length - 1 ? "border-b border-line" : ""}>
                      <td className="px-4 py-2.5 text-ink-soft">{row.q}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-faint">{row.pct}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink">{row.usd}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink">{row.zig}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="mistakes" className="mt-12 scroll-mt-6">
          <SectionHeading n="06" title="Common mistakes" />
          <Card className="mt-4 border-danger/30">
            <ul className="space-y-2.5 text-sm leading-relaxed text-ink-soft">
              {MISTAKES.map((m) => (
                <li key={m} className="flex gap-2.5">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-danger" />
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <section id="faq" className="mt-12 scroll-mt-6">
          <SectionHeading n="07" title="Frequently asked questions" />
          <Card className="mt-4">
            {FAQ.map((item) => (
              <Disclosure key={item.q} summary={item.q}>
                {item.a}
              </Disclosure>
            ))}
          </Card>
        </section>

        <p className="mt-10 text-xs leading-relaxed text-ink-faint">
          This page is a reference for how figures are derived, not tax
          advice — rates and rules reflect our best understanding of current
          ZIMRA policy and can change with each national budget. See our{" "}
          <Link href="/legal/disclaimer" className="text-usd hover:underline">
            disclaimer
          </Link>{" "}
          and confirm anything material against ZIMRA&apos;s TaRMS portal or a
          registered tax practitioner.
        </p>

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
