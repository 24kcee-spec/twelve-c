import Link from "next/link";
import { Button, Card, Eyebrow, Logo } from "@/components/ui";

export const metadata = { title: "Know Your Taxes | Twelve C" };

type EntityType = {
  name: string;
  who: string;
  liability: string;
  incomeTax: string;
  notes: string;
};

const ENTITY_TYPES: EntityType[] = [
  {
    name: "Sole Trader",
    who: "One person, trading in their own name, no formal registration with the Companies Registry.",
    liability: "Unlimited — your personal assets are exposed to business debts.",
    incomeTax: "Personal income tax bands (0%–40%) plus 3% AIDS levy, not the flat company rate.",
    notes: "Cheapest and fastest to start, but no separation between you and the business. Still must register with ZIMRA for a TIN and still crosses the VAT threshold like anyone else.",
  },
  {
    name: "Private Business Corporation (PBC)",
    who: "1–20 members. Popular with sole operators and professionals (consultants, architects, accountants) who want liability protection without a full company structure.",
    liability: "Limited to what each member invested — personal assets are protected.",
    incomeTax: "25% corporate rate + 3% AIDS levy (25.75% effective) on taxable income.",
    notes: "Member-managed — no company secretary or board required, which keeps compliance lighter than a Pvt Ltd.",
  },
  {
    name: "Private Limited Company (Pvt Ltd)",
    who: "The standard structure for SMEs through to large businesses. Requires at least one director and a resident company secretary.",
    liability: "Limited to shareholders' investment in shares.",
    incomeTax: "25% corporate rate + 3% AIDS levy (25.75% effective) on taxable income.",
    notes: "Preferred by banks, tenders, and larger trading partners. Must file annual returns with the Companies and Deeds Registry on top of ZIMRA obligations.",
  },
  {
    name: "Partnership",
    who: "Two or more people trading together under an agreement, without registering a separate corporate entity.",
    liability: "Unlimited and joint — each partner can be held liable for the whole debt, not just their share.",
    incomeTax: "Each partner is taxed individually on their share of the profit, at personal income tax bands.",
    notes: "Can be registered voluntarily under the COBE Act. Worth a written partnership agreement even though it isn't legally required.",
  },
];

type TaxType = {
  name: string;
  appliesTo: string;
  rate: string;
  due: string;
};

const TAX_TYPES: TaxType[] = [
  {
    name: "Income Tax — QPDs",
    appliesTo: "Every registered company, PBC, and any individual with business or investment income outside formal employment. This is the tax Twelve C calculates.",
    rate: "25.75% effective for companies/PBCs (25% + 3% AIDS levy). Individuals use the progressive personal bands instead, also plus the 3% AIDS levy.",
    due: "Four unequal instalments: 10% by 25 March, 25% by 25 June, 30% by 25 September, 35% by 20 December.",
  },
  {
    name: "VAT (Value Added Tax)",
    appliesTo: "Any business whose taxable supplies exceed, or are reasonably expected to exceed, US$25,000 (or ZiG equivalent) in any rolling 12-month period. Registration is compulsory once you cross it, and voluntary below it.",
    rate: "15.5% standard rate on most goods and services (raised from 15% on 1 January 2026). Some supplies are zero-rated or exempt.",
    due: "VAT returns and payment by the 25th of the month following the tax period.",
  },
  {
    name: "PAYE (Pay As You Earn)",
    appliesTo: "Any business with employees — withheld from salaries and remitted on their behalf.",
    rate: "Progressive bands set by ZIMRA's PAYE tables, reviewed periodically.",
    due: "By the 10th of the month following the payroll month.",
  },
  {
    name: "Presumptive Tax",
    appliesTo: "A simplified flat-fee alternative to full self-assessment for specific informal or small-scale operators — transport operators, hairdressing salons, informal traders, cross-border traders, and certain unregistered merchandising categories (spare parts, hardware, clothing, groceries, car dealers, lodges).",
    rate: "Fixed amounts per period rather than a percentage of profit — for example a set quarterly figure per category, not calculated from your books.",
    due: "Varies by category — commonly monthly or quarterly.",
  },
  {
    name: "Withholding Taxes",
    appliesTo: "Specific payment types — contract payments to unregistered suppliers, non-resident fees, royalties, and shareholder distributions.",
    rate: "Typically 10%–15% depending on the payment type.",
    due: "Usually within 10–30 days of the payment being made.",
  },
];

export default function LearnPage() {
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
        <Eyebrow>Know your taxes</Eyebrow>
        <h1 className="mt-2 font-display text-3xl text-ink">
          Zimbabwean business tax, in plain language
        </h1>
        <p className="mt-3 max-w-xl text-sm text-ink-soft">
          Twelve C calculates your QPD provisional tax, but QPDs are only one
          piece of what ZIMRA expects from a trading business. This page is a
          quick, honest map of the rest — what applies to you, and roughly
          when.
        </p>

        {/* Entity types */}
        <section className="mt-12">
          <h2 className="font-display text-xl text-ink">
            1. What kind of business are you?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Zimbabwe's Companies and Other Business Entities Act (COBE Act)
            recognises several structures. Which one you're trading as
            changes your liability exposure and, in some cases, which income
            tax rules apply to you.
          </p>
          <div className="mt-6 space-y-4">
            {ENTITY_TYPES.map((entity) => (
              <Card key={entity.name}>
                <h3 className="font-display text-lg text-ink">{entity.name}</h3>
                <dl className="mt-3 space-y-2.5 text-sm">
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
                      Who it's for
                    </dt>
                    <dd className="mt-0.5 leading-relaxed text-ink-soft">{entity.who}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
                      Liability
                    </dt>
                    <dd className="mt-0.5 leading-relaxed text-ink-soft">{entity.liability}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
                      Income tax treatment
                    </dt>
                    <dd className="mt-0.5 leading-relaxed text-ink-soft">{entity.incomeTax}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
                      Worth knowing
                    </dt>
                    <dd className="mt-0.5 leading-relaxed text-ink-soft">{entity.notes}</dd>
                  </div>
                </dl>
              </Card>
            ))}
          </div>
        </section>

        {/* VAT callout - the specific question that prompted this page */}
        <section className="mt-12 rounded-md border border-zig/30 bg-zig-soft p-5">
          <Eyebrow>The question people actually ask</Eyebrow>
          <h2 className="mt-2 font-display text-lg text-ink">
            Do I need to register for VAT?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            You must register once your taxable supplies exceed, or are
            reasonably expected to exceed,{" "}
            <strong className="text-ink">US$25,000 (or ZiG equivalent) in any rolling 12-month period</strong>{" "}
            — not necessarily a calendar year, any 12-month window. As a rough
            monthly guide that works out to about US$2,083/month sustained
            over a year, though ZIMRA's own test is the 12-month total, not a
            single month's figure.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Below that threshold, you can still register voluntarily — useful
            if your customers are VAT-registered businesses who want to claim
            input tax on what they buy from you. Once you're VAT-registered
            (voluntary or compulsory), the same obligations apply: charge
            15.5% on standard-rated supplies, issue fiscal tax invoices, and
            file by the 25th of the following month.
          </p>
          <p className="mt-2 text-xs text-ink-faint">
            Source: ZIMRA VAT Registration notice, effective 1 January 2024
            (threshold) and 1 January 2026 (15.5% rate).
          </p>
        </section>

        {/* Tax types */}
        <section className="mt-12">
          <h2 className="font-display text-xl text-ink">
            2. Which taxes might apply to you
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Most trading businesses deal with two or three of these, not all
            five. Presumptive Tax and full QPD self-assessment are generally
            alternatives to each other, not both at once.
          </p>
          <div className="mt-6 space-y-4">
            {TAX_TYPES.map((tax) => (
              <Card key={tax.name}>
                <h3 className="font-display text-lg text-ink">{tax.name}</h3>
                <dl className="mt-3 space-y-2.5 text-sm">
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
                      Applies to
                    </dt>
                    <dd className="mt-0.5 leading-relaxed text-ink-soft">{tax.appliesTo}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
                      Rate
                    </dt>
                    <dd className="mt-0.5 leading-relaxed text-ink-soft">{tax.rate}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
                      Due
                    </dt>
                    <dd className="mt-0.5 leading-relaxed text-ink-soft">{tax.due}</dd>
                  </div>
                </dl>
              </Card>
            ))}
          </div>
        </section>

        <p className="mt-8 text-xs leading-relaxed text-ink-faint">
          This page is educational context, not tax advice — rates,
          thresholds, and categories above reflect our best understanding of
          current ZIMRA rules and can change with each national budget. See
          our{" "}
          <Link href="/legal/disclaimer" className="text-usd hover:underline">
            disclaimer
          </Link>{" "}
          and always confirm anything material against ZIMRA's TaRMS portal or
          a registered tax practitioner.
        </p>

        <div className="mt-10 rounded-md border border-usd/30 bg-usd-soft p-5 text-center">
          <p className="text-sm text-ink-soft">
            Ready to calculate your actual QPD numbers?
          </p>
          <Link href="/register" className="mt-3 inline-block">
            <Button variant="primary">Get started</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}