import Link from "next/link";
import { Eyebrow, Logo } from "@/components/ui";

export const metadata = {
  title: "Methodology | Twelve C",
  description:
    "How Twelve C calculates ZIMRA QPD provisional tax: statutory rates, the QPD schedule, the dual-currency apportionment rule, and worked examples.",
};

function SectionNumber({ n }: { n: string }) {
  return (
    <span className="mr-3 inline-flex h-7 w-7 items-center justify-center rounded-sm bg-ink font-mono text-xs text-paper">
      {n}
    </span>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-14">
      <h2 className="flex items-center border-b border-line pb-3 font-display text-2xl text-ink">
        <SectionNumber n={number} />
        {title}
      </h2>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

function RateTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="overflow-hidden rounded-md border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-ink">
            {columns.map((c, i) => (
              <th
                key={c}
                className={`px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper ${
                  i > 0 ? "text-right" : "text-left"
                }`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 1 ? "bg-paper" : "bg-surface"}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`border-t border-line px-4 py-2 text-ink-soft ${
                    ci > 0 ? "text-right font-mono tabular-nums" : "text-ink"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded border border-line bg-paper p-4 font-mono text-xs leading-relaxed text-ink-soft">
      {children}
    </pre>
  );
}

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line border-l-4 border-l-ink bg-surface p-5 shadow-card">
      <p className="font-mono text-xs uppercase tracking-wide text-ink-faint">{title}</p>
      <div className="mt-2 space-y-2 text-sm text-ink-soft">{children}</div>
    </div>
  );
}

export default function MethodologyPage() {
  return (
    <main className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-6">
        <Link href="/">
          <Logo />
        </Link>
        <Link href="/" className="text-sm text-ink-soft transition hover:text-ink">
          Back to home
        </Link>
      </header>

      <div className="mx-auto max-w-4xl px-6 pb-24">
        <Eyebrow>Methodology</Eyebrow>
        <h1 className="mt-2 font-display text-4xl leading-tight text-ink md:text-5xl">
          How Twelve C calculates your QPD
        </h1>
        <p className="mt-5 max-w-2xl text-ink-soft">
          Every rate and rule below is verified against ZIMRA&apos;s published rates and the
          ITF12C workbook formulas &mdash; not guessed, not copied from a summary site. This is
          the same specification the calculation engine is tested against, thirteen automated
          tests deep.
        </p>

        <Section number="1" title="Statutory rates">
          <RateTable
            columns={["Rate", "Value", "Source"]}
            rows={[
              ["Corporate income tax", "25%", "ZIMRA Tax Rates page"],
              ["AIDS levy", "3% of tax payable", "ZIMRA Tax Rates page"],
              ["Effective combined rate", "25.75%", "0.25 \u00d7 1.03"],
            ]}
          />
          <Callout title="Verification">
            <p>
              Confirmed directly on zimra.co.zw: &ldquo;Income of company or trust &mdash; 25%&rdquo;
              and &ldquo;Aids Levy: Rate is based on tax chargeable &mdash; 3%&rdquo;. This matches
              the hardcoded rates in the ITF12C 2025 workbook.
            </p>
            <p>
              A 24% + 3% = 24.72% figure circulates on some third-party tax-summary sites. It does
              not match ZIMRA&apos;s own current page and is treated as stale.
            </p>
          </Callout>
        </Section>

        <Section number="2" title="QPD schedule">
          <p className="text-sm text-ink-soft">
            Each quarter&apos;s instalment is a fixed percentage of total annual tax.
          </p>
          <RateTable
            columns={["Quarter", "Due date", "Statutory %", "Cumulative %"]}
            rows={[
              ["QPD 1", "25 March", "10%", "10%"],
              ["QPD 2", "25 June", "25%", "35%"],
              ["QPD 3", "25 September", "30%", "65%"],
              ["QPD 4", "20 December", "35%", "100%"],
            ]}
          />
        </Section>

        <Section number="3" title="Dual-currency apportionment (Public Notice 71)">
          <p className="text-sm font-medium text-ink">Trade ratio</p>
          <CodeBlock>{`usd_ratio = usd_sales / (usd_sales + zig_sales_in_usd)
zig_ratio = zig_sales_in_usd / (usd_sales + zig_sales_in_usd)
(zig_sales_in_usd = zig_sales / exchange_rate)`}</CodeBlock>

          <p className="text-sm font-medium text-ink">The cap</p>
          <CodeBlock>{`IF usd_ratio > zig_ratio:
    payment_ratio_usd = 0.5
    payment_ratio_zig = 0.5
ELSE:
    payment_ratio_usd = usd_ratio
    payment_ratio_zig = zig_ratio`}</CodeBlock>

          <p className="text-sm text-ink-soft">
            This is a hard, exact 50/50 split &mdash; not a proportional split, not a
            &ldquo;minimum 50%&rdquo; floor &mdash; applied the moment USD trade exceeds ZiG
            trade, however slightly. The same ratio is applied uniformly to adjusted income and to
            every deduction line. When ZiG trade dominates, no cap applies &mdash; the real trade
            ratio is used unmodified.
          </p>

          <Callout title="Where this differs from other published specs">
            <p>
              A commonly-circulated alternative spec describes the cap as &ldquo;apportion
              expenses by the revenue split ratio, ensure USD tax is at least 50%&rdquo; &mdash; a
              proportional method with a floor.
            </p>
            <p>
              That description does not match the source workbook&apos;s formula, and its own
              worked example never actually enforces a 50% floor &mdash; it produces the same
              result as pure proportional apportionment.
            </p>
            <p>
              Twelve C follows the workbook&apos;s literal formula: an exact 50/50 split of income
              and deductions once USD is dominant, not a floor on the final tax split.
            </p>
          </Callout>
        </Section>

        <Section number="4" title="Worked example">
          <p className="text-sm text-ink-soft">
            USD sales $12,000 &middot; USD salaries $3,000 &middot; USD other expenses $8,900
            &middot; exchange rate 26.8 &middot; no ZiG activity. 100% USD trade, so the cap
            engages.
          </p>
          <RateTable
            columns={["Metric", "USD", "ZiG"]}
            rows={[
              ["Trade ratio", "100%", "0%"],
              ["Payment ratio (after cap)", "50%", "50%"],
              ["Adjusted income", "6,000.00", "160,800.00"],
              ["Adjusted deductions", "5,950.00", "159,460.00"],
              ["Taxable profit", "50.00", "1,340.00"],
              ["Tax payable (25%)", "12.50", "335.00"],
              ["AIDS levy (3%)", "0.375", "10.05"],
              ["Total annual tax", "12.875", "345.05"],
              ["QPD 1 (10%)", "1.29", "34.51"],
            ]}
          />
        </Section>

        <Section number="5" title="Edge cases and validation">
          <ul className="list-disc space-y-2 pl-5 text-sm text-ink-soft">
            <li>Zero exchange rate is rejected outright &mdash; division by zero is never silently swallowed.</li>
            <li>Negative sales figures are rejected outright.</li>
            <li>
              Zero income with real expenses entered does not silently zero out &ldquo;adjusted
              deductions&rdquo; &mdash; it defaults to a 50/50 split so the displayed figure stays
              honest. Final tax is unaffected either way, since taxable profit is clamped at zero.
            </li>
            <li>
              Payments are tracked per instalment and persist independently of the annual
              estimate.
            </li>
          </ul>
        </Section>

        <footer className="mt-16 border-t border-line pt-6 text-xs text-ink-faint">
          Sources: ITF12C 2025 workbook (2026 QPD Calculator.xlsx) &middot;
          zimra.co.zw/domestic-taxes/corporate/tax-rates &middot; 13 passing engine tests. Twelve C
          is an independent calculator and is not affiliated with the Zimbabwe Revenue Authority.
        </footer>
      </div>
    </main>
  );
}
