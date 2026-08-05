import Link from "next/link";
import { LegalLayout, LSection, LList } from "@/components/LegalLayout";

export const metadata = { title: "Terms of Service | Twelve C" };

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="5 August 2026">
      <p className="text-sm leading-relaxed text-ink-soft">
        These Terms of Service ("Terms") govern your use of Twelve C
        (the "App", "Service"), provided by 24kcee-spec
        ("we", "us", "our"), operating from Bulawayo,
        Zimbabwe. By creating an account or using Twelve C, you agree to
        these Terms. 24kcee-spec is not currently a registered company in
        Zimbabwe, it is an individually-operated service.
      </p>

      <LSection title="1. What Twelve C is">
        <p>
          Twelve C is a calculation and record-keeping tool that helps
          business owners estimate ZIMRA Quarterly Payment Date (QPD)
          provisional tax obligations across USD and ZiG. See our{" "}
          <Link href="/legal/disclaimer" className="font-medium text-usd">
            Disclaimer
          </Link>{" "}
          for important limits on what the App does and does not do, read it
          before relying on any figure the App produces.
        </p>
      </LSection>

      <LSection title="2. Eligibility">
        <p>
          You must be at least 18 years old and legally able to enter into a
          binding agreement to use Twelve C. If you use Twelve C on behalf of
          a business, you confirm you have the authority to do so.
        </p>
      </LSection>

      <LSection title="3. Your account">
        <LList
          items={[
            "You are responsible for keeping your login credentials confidential and for all activity under your account",
            "You agree to provide accurate information when registering and adding businesses",
            "Notify us immediately at 24kcee@gmail.com if you suspect unauthorized access to your account",
            "We may suspend or terminate accounts used for fraudulent, abusive, or unlawful activity",
          ]}
        />
      </LSection>

      <LSection title="4. Acceptable use">
        <p>You agree not to:</p>
        <LList
          items={[
            "Use the App for any unlawful purpose",
            "Attempt to gain unauthorized access to the App, other users' accounts, or our infrastructure",
            "Interfere with or disrupt the App's operation",
            "Reverse-engineer the App except as permitted by law",
            "Use the App to generate figures you intend to submit to ZIMRA without independent verification, where the App's own Disclaimer states verification is required",
          ]}
        />
      </LSection>

      <LSection title="5. Fees">
        <p>
          Twelve C is currently provided free of charge. We reserve the right
          to introduce fees for the Service or specific features in the
          future, with reasonable advance notice to users.
        </p>
      </LSection>

      <LSection title="6. Data and privacy">
        <p>
          Our collection and use of your personal information is described
          in our{" "}
          <Link href="/legal/privacy-policy" className="font-medium text-usd">
            Privacy Policy
          </Link>
          , which forms part of these Terms.
        </p>
      </LSection>

      <LSection title="7. Intellectual property">
        <p>
          The App, its design, code, and content (excluding your own
          business data that you enter) belong to 24kcee-spec. You may not
          copy, resell, or redistribute the App without our written
          permission.
        </p>
      </LSection>

      <LSection title="8. No warranty">
        <p>
          The App is provided "as is" and "as
          available." We do not guarantee it will be uninterrupted,
          error-free, or fit for any particular purpose beyond what is
          stated in our Disclaimer.
        </p>
      </LSection>

      <LSection title="9. Limitation of liability">
        <p>
          To the maximum extent permitted by Zimbabwean law, 24kcee-spec's
          total liability to you for any claim arising from your use of the
          App is limited to the amount (if any) you paid us for the Service
          in the three months before the claim arose.
        </p>
      </LSection>

      <LSection title="10. Changes to the Service or these Terms">
        <p>
          We may update the App or these Terms from time to time. Material
          changes will be communicated via the App or the email address on
          your account. Continued use after a change takes effect means you
          accept the updated Terms.
        </p>
      </LSection>

      <LSection title="11. Termination">
        <p>
          You may stop using the App and request account deletion at any
          time by emailing 24kcee@gmail.com. We may suspend or terminate your
          access if you breach these Terms.
        </p>
      </LSection>

      <LSection title="12. Governing law">
        <p>
          These Terms are governed by the laws of Zimbabwe. Any dispute will
          be subject to the jurisdiction of the courts of Zimbabwe.
        </p>
      </LSection>

      <LSection title="13. Contact">
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
