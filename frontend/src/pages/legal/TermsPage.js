import React from 'react';
import { Link } from 'react-router-dom';
import PublicLegalLayout from '../../components/PublicLegalLayout';

const UPDATED = 'March 21, 2026';

export default function TermsPage() {
  return (
    <PublicLegalLayout title="Terms of Use" lastUpdated={UPDATED}>
      <p className="text-slate-400">
        These Terms of Use (&quot;Terms&quot;) govern your access to and use of Two Loonies&apos; website
        and services (&quot;Service&quot;). By using the Service, you agree to these Terms. If you do not
        agree, do not use the Service.
      </p>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">1. The Service</h2>
        <p>
          Two Loonies provides tools to help you visualize and understand personal financial information
          you choose to connect or upload. We may modify or discontinue features with reasonable notice
          where practicable.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">2. Not professional advice</h2>
        <p>
          The Service is for informational purposes only. Nothing we provide is financial, investment, tax,
          legal, or accounting advice. You are solely responsible for your financial decisions. Always
          consult qualified professionals before acting on information from the Service.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">3. AI and accuracy</h2>
        <p>
          The Service may use automated systems, including artificial intelligence, to process your
          content. Outputs may contain errors, omissions, or misinterpretations. Parsed transaction
          amounts, balances, and categories are for your organization and visualization only and are
          not tax, investment, or accounting advice. You must independently verify balances,
          transactions, and categories against your official bank or broker records.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">4. Your account</h2>
        <p>
          You must provide accurate registration information and keep your credentials confidential. You
          are responsible for activity under your account. Notify us promptly if you suspect unauthorized
          access.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">5. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul className="list-disc pl-5 space-y-2 mt-2">
          <li>use the Service unlawfully or to harm others;</li>
          <li>attempt to gain unauthorized access to our systems or other users&apos; data;</li>
          <li>reverse engineer, scrape, or overload the Service except as allowed by law;</li>
          <li>upload malware or content you do not have the right to share; or</li>
          <li>use the Service in violation of third-party terms (for example, your financial
            institution&apos;s agreements).
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">6. Your content</h2>
        <p>
          You retain ownership of information you submit. You grant Two Loonies a licence to host,
          process, transmit, and display that information as needed to provide and improve the Service,
          including through subprocessors described in our Privacy Policy and Subprocessors page.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">7. Third-party services</h2>
        <p>
          The Service may integrate with third parties (for example, bank linking or cloud AI). Their
          services are subject to their own terms and privacy policies. We are not responsible for
          third-party services we do not control.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">8. Disclaimers</h2>
        <p>
          THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY
          KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
          AND NON-INFRINGEMENT, TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">9. Limitation of liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, TWO LOONIES AND ITS SUPPLIERS WILL NOT BE
          LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS
          OF PROFITS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF THE SERVICE. OUR AGGREGATE LIABILITY FOR
          CLAIMS RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU PAID US FOR
          THE SERVICE IN THE TWELVE MONTHS BEFORE THE CLAIM OR (B) ONE HUNDRED CANADIAN DOLLARS (CAD $100),
          IF YOU HAVE NOT PAID US. SOME JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS; IN THOSE CASES,
          OUR LIABILITY IS LIMITED TO THE FULLEST EXTENT PERMITTED BY LAW.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">10. Indemnity</h2>
        <p>
          You will defend and indemnify Two Loonies against claims arising from your misuse of the
          Service, your content, or your violation of these Terms, to the extent permitted by law.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">11. Termination</h2>
        <p>
          We may suspend or terminate access if you breach these Terms or if we need to protect the
          Service or other users. You may stop using the Service at any time. Provisions that by their
          nature should survive will survive termination.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">12. Governing law</h2>
        <p>
          These Terms are governed by the laws of Canada and the province in which Two Loonies operates,
          excluding conflict-of-law rules. Courts in that province have exclusive jurisdiction, subject to
          mandatory consumer protection rules where applicable.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mt-2 mb-2">13. Privacy</h2>
        <p>
          Our{' '}
          <Link to="/privacy" className="text-amber-400/90 hover:text-amber-300 underline">
            Privacy Policy
          </Link>{' '}
          explains how we handle personal information.
        </p>
      </section>
    </PublicLegalLayout>
  );
}
