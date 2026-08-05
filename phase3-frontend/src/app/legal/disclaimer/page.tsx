import { LegalLayout, LSection, LList } from "@/components/LegalLayout";

export const metadata = { title: "Disclaimer | Twelve C" };

export default function DisclaimerPage() {
  return (
    <LegalLayout title="Disclaimer" lastUpdated="5 August 2026">
      <p className="text-sm leading-relaxed text-ink-soft">
        Twelve C ("the App", "the Service") is provided by 24kcee-spec
        ("we", "us", "our"), operating from Bulawayo, Zimbabwe.
        Twelve C is a calculation tool that helps small business owners
        estimate their ZIMRA Quarterly Payment Date (QPD) provisional tax
        obligations.
      </p>

      <LSection title="1. Not tax, legal, or financial advice">
        <p>Twelve C is a calculation aid only. It is not:</p>
        <LList
          items={[
            "A registered tax practitioner, accountant, or law firm",
            "A substitute for advice from a registered tax practitioner, accountant, or lawyer",
            "An official ZIMRA system, portal, or service",
            "A guarantee of accuracy for any specific business's actual tax liability",
          ]}
        />
        <p>
          The calculations produced by Twelve C are estimates based on our
          understanding of the ZIMRA QPD rules, Public Notice 71 of 2024, and
          the currently configured tax and AIDS levy rates at the time of
          calculation. Tax law, rates, and ZIMRA's own interpretation of
          the rules can change without notice.
        </p>
      </LSection>

      <LSection title="2. Your responsibility">
        <p>You are solely responsible for:</p>
        <LList
          items={[
            "Verifying any figure produced by Twelve C against ZIMRA's official TaRMS portal, official ZIMRA publications, or a registered tax practitioner before filing or paying",
            "Confirming the exchange rate, tax rate, and AIDS levy rate used in any calculation are current at the time you rely on them",
            "Any filing, payment, penalty, interest, or other consequence arising from reliance on a Twelve C calculation without independent verification",
          ]}
        />
      </LSection>

      <LSection title="3. No liability">
        <p>
          To the maximum extent permitted by Zimbabwean law, 24kcee-spec
          accepts no liability for any loss, penalty, interest, additional
          tax assessed, or other damage arising from:
        </p>
        <LList
          items={[
            "Use of, or inability to use, Twelve C",
            "Any error, bug, or inaccuracy in a calculation",
            "Any change in ZIMRA rates, rules, or interpretation not yet reflected in the App",
            "Any decision made based on a Twelve C calculation without independent professional verification",
          ]}
        />
      </LSection>

      <LSection title="4. Rate accuracy">
        <p>
          Tax rate, AIDS levy rate, and the multi-currency 50/50 capping rule
          applied by Twelve C are configured based on our best understanding
          of current ZIMRA rules at the time shown in the App. We make
          reasonable efforts to keep these current but do not guarantee they
          reflect the most recent ZIMRA rate changes, budget announcements,
          or public notices at every moment.
        </p>
      </LSection>

      <LSection title="5. Contact">
        <p>
          Questions about this disclaimer:{" "}
          <a href="mailto:24kcee@gmail.com" className="font-medium text-usd">
            24kcee@gmail.com
          </a>
        </p>
      </LSection>
    </LegalLayout>
  );
}
