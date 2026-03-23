import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import PublicLegalLayout from '../../components/PublicLegalLayout';

const UPDATED = 'March 21, 2026';

export default function PrivacyPage() {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    const id = hash.replace(/^#/, '');
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  return (
    <PublicLegalLayout title="Privacy Policy" lastUpdated={UPDATED}>
      <p className="text-slate-400">
        This policy describes how Two Loonies (&quot;we&quot;, &quot;us&quot;) collects, uses, and discloses
        personal information in connection with our website and services. It is a plain-language summary
        for transparency; it is not legal advice. We encourage you to speak with qualified professionals
        about your own situation.
      </p>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">1. Who we are</h2>
        <p>
          Two Loonies operates a Canadian-focused personal finance tool. For privacy requests, contact us
          at the support channel listed on the site (we will publish a dedicated privacy inbox before
          broader launch).
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">2. Information we collect</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-slate-200">Account data:</strong> email address and credentials you
            provide when you create an account.
          </li>
          <li>
            <strong className="text-slate-200">Financial information you choose to share:</strong> for
            example, data from linked financial institutions (via our bank-linking partner), or
            information extracted from documents you upload (such as account identifiers, balances, and
            transactions as they appear on statements).
          </li>
          <li>
            <strong className="text-slate-200">Technical and usage data:</strong> IP address, device and
            browser type, general log data, and cookies or similar technologies needed to operate and
            secure the service.
          </li>
          <li>
            <strong className="text-slate-200">Support communications:</strong> messages you send us.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">3. How we use information</h2>
        <p>We use personal information to:</p>
        <ul className="list-disc pl-5 space-y-2 mt-2">
          <li>provide, maintain, and improve the service;</li>
          <li>authenticate users and protect against fraud and abuse;</li>
          <li>respond to support requests;</li>
          <li>comply with law and enforce our terms; and</li>
          <li>generate aggregated or de-identified statistics where permitted.</li>
        </ul>
      </section>

      <section id="ai">
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">4. Artificial intelligence</h2>
        <p>
          Parts of the service may use machine learning or third-party AI models to parse documents,
          categorize activity, or generate suggestions. Automated outputs can be wrong or incomplete. You
          should verify important information against your original records. We do not provide financial,
          tax, or legal advice.
        </p>
        <p>
          Depending on configuration, content you submit may be processed by subprocessors (for example,
          cloud AI providers) as described on our{' '}
          <Link to="/legal/subprocessors" className="text-amber-400/90 hover:text-amber-300 underline">
            Subprocessors
          </Link>{' '}
          page.
        </p>
      </section>

      <section id="security">
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">5. Security</h2>
        <p>
          We use industry-standard safeguards appropriate to the nature of the data, such as encryption in
          transit and access controls. No method of transmission or storage is completely secure.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">6. Disclosure and subprocessors</h2>
        <p>
          We share personal information with service providers who help us run the product (hosting,
          database, authentication, bank linking, AI inference, analytics, and similar functions). They may
          process data in Canada, the United States, or other countries where privacy laws differ. See our{' '}
          <Link to="/legal/subprocessors" className="text-amber-400/90 hover:text-amber-300 underline">
            Subprocessors
          </Link>{' '}
          page for categories and examples.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">7. Canadian privacy rights</h2>
        <p>
          Depending on where you live, you may have rights under Canada&apos;s federal{' '}
          <em>Personal Information Protection and Electronic Documents Act</em> (PIPEDA) and/or
          applicable provincial laws (for example, Alberta&apos;s PIPA, British Columbia&apos;s PIPA, or
          Quebec&apos;s privacy framework). These may include rights to access or correct your personal
          information and, in some cases, to withdraw consent subject to legal or contractual
          restrictions.
        </p>
        <p>
          You may file a complaint with the Office of the Privacy Commissioner of Canada or, where
          applicable, a provincial privacy commissioner.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">8. Retention</h2>
        <p>
          We retain information only as long as needed for the purposes above, including legal,
          accounting, and security requirements. You may request deletion of your account data subject to
          exceptions (for example, backups or legal holds).
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">9. Children</h2>
        <p>The service is not directed at individuals under the age of majority in their province.</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">10. Changes</h2>
        <p>
          We may update this policy from time to time. We will post the revised version with a new
          &quot;Last updated&quot; date and, where changes are material, provide additional notice as
          appropriate.
        </p>
      </section>
    </PublicLegalLayout>
  );
}
