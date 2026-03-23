import React from 'react';
import PublicLegalLayout from '../../components/PublicLegalLayout';

const UPDATED = 'March 21, 2026';

const ROWS = [
  {
    name: 'Supabase',
    purpose: 'Authentication, database, storage, and serverless functions',
    region: 'As configured in your Supabase project (may include non-Canadian regions)',
    link: 'https://supabase.com/privacy',
  },
  {
    name: 'Plaid',
    purpose: 'Optional bank account linking and financial data aggregation',
    region: 'United States and other regions per Plaid',
    link: 'https://plaid.com/legal/',
  },
  {
    name: 'Google (Gemini / AI services)',
    purpose: 'Optional AI-assisted parsing or categorization of user-submitted content',
    region: 'United States and other regions per Google',
    link: 'https://policies.google.com/privacy',
  },
  {
    name: 'Hosting / infrastructure',
    purpose: 'Application and API hosting (e.g. Vercel or similar)',
    region: 'As determined by your deployment region',
    link: null,
  },
];

export default function SubprocessorsPage() {
  return (
    <PublicLegalLayout title="Subprocessors" lastUpdated={UPDATED}>
      <p className="text-slate-400">
        We use the categories of subprocessors below to operate Two Loonies. This list is illustrative;
        exact vendors and data flows depend on how your environment is configured. We will update this
        page when we add or replace material subprocessors.
      </p>

      <div className="overflow-x-auto rounded-xl border border-white/10 mt-6">
        <table className="w-full text-left text-sm min-w-[32rem]">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.03]">
              <th className="py-3 px-4 font-semibold text-slate-200">Subprocessor</th>
              <th className="py-3 px-4 font-semibold text-slate-200">Purpose</th>
              <th className="py-3 px-4 font-semibold text-slate-200">Typical region</th>
              <th className="py-3 px-4 font-semibold text-slate-200">Privacy</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.name} className="border-b border-white/5 last:border-0">
                <td className="py-3 px-4 text-slate-200 align-top">{row.name}</td>
                <td className="py-3 px-4 align-top">{row.purpose}</td>
                <td className="py-3 px-4 text-slate-400 align-top">{row.region}</td>
                <td className="py-3 px-4 align-top">
                  {row.link ? (
                    <a
                      href={row.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-400/90 hover:text-amber-300 underline"
                    >
                      Policy
                    </a>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-white mb-2">Cross-border processing</h2>
        <p>
          Personal information may be processed in Canada and in other countries where subprocessors or
          their infrastructure are located. Those jurisdictions may have different privacy rules than your
          home province.
        </p>
      </section>
    </PublicLegalLayout>
  );
}
