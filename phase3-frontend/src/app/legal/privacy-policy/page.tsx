import { LegalLayout, LSection, LList } from "@/components/LegalLayout";

export const metadata = { title: "Privacy Policy | Twelve C" };

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="5 August 2026">
      <p className="text-sm leading-relaxed text-ink-soft">
        24kcee-spec ("we", "us", "our"), operating from
        Bulawayo, Zimbabwe, provides the Twelve C application ("the
        App"). This Privacy Policy explains what personal information we
        collect, why, and what rights you have over it, in line with
        Zimbabwe's Cyber and Data Protection Act [Chapter 11:12].
      </p>

      <LSection title="1. Who we are">
        <p>
          <strong className="font-semibold text-ink">Data controller:</strong>{" "}
          24kcee-spec
          <br />
          <strong className="font-semibold text-ink">Location:</strong>{" "}
          Bulawayo, Zimbabwe
          <br />
          <strong className="font-semibold text-ink">
            Contact / Data Protection queries:
          </strong>{" "}
          24kcee@gmail.com
        </p>
        <p>
          24kcee-spec is not currently a registered company in Zimbabwe, and
          registration with Zimbabwe's data protection regulator is in
          progress. This policy will be updated once that status changes.
        </p>
      </LSection>

      <LSection title="2. What we collect">
        <LList
          items={[
            "Account information: name, email address, password (stored encrypted, we never see or store your plain-text password)",
            "Business information: business name(s) and any details you enter about them",
            "Financial figures you enter: USD/ZiG sales, expenses, exchange rates, and other figures you input to run a QPD calculation",
            "Calculation history: every calculation you run, including the inputs, the rates used, and the results, timestamped, kept as your audit trail",
            "Technical data: IP address (used for security and rate-limiting), login timestamps, device/browser type",
          ]}
        />
      </LSection>

      <LSection title="3. Why we collect it">
        <LList
          items={[
            "Create and secure your account (including multi-factor authentication)",
            "Run the QPD calculations you request",
            "Maintain a timestamped record of your past calculations so you have a reference if a figure is ever questioned",
            "Detect and prevent abuse (e.g. rate limiting registration attempts)",
            "Communicate with you about your account or the Service",
          ]}
        />
        <p>
          We do not use your financial data for any purpose beyond providing
          the Service to you. We do not sell your data.
        </p>
      </LSection>

      <LSection title="4. Who can see your data">
        <LList
          items={[
            "You, full access to your own account and business data at all times",
            "Us, limited access for support, debugging, and legal compliance purposes only",
            "Infrastructure providers, Twelve C runs on third-party hosting, database, and deployment infrastructure. Some of this may be located outside Zimbabwe; where personal information is transferred outside Zimbabwe, we take reasonable steps to ensure it receives an adequate level of protection, as required by the Cyber and Data Protection Act",
          ]}
        />
        <p>
          We do not share your data with any other third party except where
          required by law.
        </p>
      </LSection>

      <LSection title="5. How we protect your data">
        <LList
          items={[
            "Passwords are stored using industry-standard hashing, never in plain text",
            "Account access is protected by JWT-based authentication and multi-factor authentication (MFA)",
            "Login and registration attempts are rate-limited to reduce abuse",
            "Access to production data is restricted to what is necessary to operate and support the Service",
          ]}
        />
        <p>
          No system is 100% secure, and we cannot guarantee absolute
          security, but we take reasonable, industry-standard measures to
          protect your information.
        </p>
      </LSection>

      <LSection title="6. How long we keep your data">
        <p>
          We keep your account and calculation history for as long as your
          account is active, plus a reasonable period afterward to comply
          with recordkeeping needs and legal obligations. You can request
          deletion at any time, see Section 7.
        </p>
      </LSection>

      <LSection title="7. Your rights">
        <p>Under the Cyber and Data Protection Act, you have the right to:</p>
        <LList
          items={[
            "Access the personal information we hold about you",
            "Correct inaccurate information",
            "Request deletion of your account and associated data",
            "Object to certain processing (e.g. opt out of reminder notifications)",
            "Withdraw consent where processing is based on consent, without affecting processing already carried out",
          ]}
        />
        <p>
          To exercise any of these rights, email{" "}
          <a href="mailto:24kcee@gmail.com" className="font-medium text-usd">
            24kcee@gmail.com
          </a>
          . We will respond within a reasonable time.
        </p>
      </LSection>

      <LSection title="8. Cookies and tracking">
        <p>
          We use only essential cookies required to keep you logged in. We do
          not use third-party advertising or tracking cookies.
        </p>
      </LSection>

      <LSection title="9. Children">
        <p>
          Twelve C is not intended for use by anyone under 18. We do not
          knowingly collect data from minors.
        </p>
      </LSection>

      <LSection title="10. Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. Material
          changes will be communicated via the App or your account email.
          The "Last updated" date at the top of this page will
          always reflect the current version.
        </p>
      </LSection>

      <LSection title="11. Complaints">
        <p>
          If you believe we have not handled your personal information
          properly, you may contact us directly at 24kcee@gmail.com, or
          lodge a complaint with Zimbabwe's data protection regulator
          (POTRAZ).
        </p>
      </LSection>

      <LSection title="12. Contact">
        <p>
          24kcee-spec, Bulawayo, Zimbabwe
          <br />
          Email:{" "}
          <a href="mailto:24kcee@gmail.com" className="font-medium text-usd">
            24kcee@gmail.com
          </a>
        </p>
      </LSection>
    </LegalLayout>
  );
}
