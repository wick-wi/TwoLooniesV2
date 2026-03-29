import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getApiKeyStatus } from '../../utils/adminApi';
import { CheckCircle, XCircle, RefreshCw } from 'lucide-react';

/** Matches api/admin_routes.py _ENV_CHECKLIST descriptions (fallback empty string if missing). */
const KEY_DESCRIPTIONS = {
  GOOGLE_API_KEY:
    'Optional Gemini credential; interchangeable with GEMINI_API_KEY for most Python paths.',
  GEMINI_API_KEY:
    'Optional Gemini credential; interchangeable with GOOGLE_API_KEY. Edge function categorize-transaction uses this name only.',
  GEMINI_MODEL_PASS1: 'Override for pass-1 model (see api/utils/gemini_model.py; also admin_config).',
  GEMINI_MODEL_PASS2: 'Override for pass-2 / instructor model.',
  STATEMENT_PARSER: 'Parser selection: docling | gemini_native | pdfplumber | pdfplumber_v2 (env; can override via admin_config).',
  SUPABASE_URL: 'Supabase project URL — required for JWT verification and DB client.',
  SUPABASE_SECRET_KEY: 'Service role / secret key (or legacy SUPABASE_SERVICE_KEY) for backend Supabase client.',
  SUPABASE_JWT_SECRET: 'HS256 fallback for validating user JWTs when JWKS path is not used.',
  PLAID_CLIENT_ID: 'Plaid client identifier for link token / exchange endpoints.',
  PLAID_SECRET: 'Plaid secret for server-side Plaid API calls.',
  PLAID_ENV: 'Plaid environment, e.g. sandbox or production.',
  QSTASH_TOKEN: 'Required for publishing async statement jobs to QStash.',
  QSTASH_URL: 'Optional QStash API base URL (SDK default is usually enough if unset).',
  QSTASH_CURRENT_SIGNING_KEY: 'Verifies incoming QStash webhook signatures (see api/index.py).',
  QSTASH_NEXT_SIGNING_KEY: 'Secondary signing key during QStash key rotation.',
  QSTASH_CALLBACK_BASE_URL: 'Public base URL for QStash to call back into your API.',
  APP_PUBLIC_URL: 'Alternative public URL used when QSTASH_CALLBACK_BASE_URL is unset.',
  USE_QSTASH: 'Set to 0/false/no to force in-process BackgroundTasks instead of QStash.',
  UPSTASH_REDIS_REST_URL: 'Upstash Redis REST endpoint (paired with REST token for job state).',
  UPSTASH_REDIS_REST_TOKEN: 'Upstash Redis REST token.',
  REDIS_URL: 'TCP Redis URL when not using Upstash REST (e.g. local redis://).',
  DOCLING_MODE: 'How Docling runs: local vs remote service (see api/docling_client.py).',
  DOCLING_SERVICE_URL: 'Remote Docling service base URL when using remote mode.',
  DOCLING_CONVERT_PATH: 'Optional path suffix for Docling convert endpoint.',
  STATEMENT_PDF_BUCKET: 'Supabase Storage bucket for statement PDFs (default statement-pdfs).',
  ENABLE_PASS3: 'Enable Docling pass-3 when pass 1/2 validation fails (default true if unset).',
  CORS_ALLOWED_ORIGINS: 'Extra allowed CORS origins for the API (comma-separated).',
};

export default function ApiKeysPage() {
  const { getAccessToken } = useAuth();
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getApiKeyStatus(getAccessToken());
      setKeys(res.data.keys || []);
    } catch {
      setError('Failed to load key status. Make sure you have admin access.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const keysWithHeaders = useMemo(() => {
    const out = [];
    let prevSection = null;
    keys.forEach((k) => {
      if (k.section && k.section !== prevSection) {
        out.push({ type: 'header', section: k.section });
        prevSection = k.section;
      }
      out.push({ type: 'row', ...k });
    });
    return out;
  }, [keys]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Environment checklist</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            What the Python API process sees (Vercel serverless or local). Not your full Vercel project list.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="mb-4 space-y-2 rounded-lg border border-amber-700/40 bg-amber-950/20 px-4 py-3 text-xs text-amber-400">
        <p>
          <span className="text-amber-300">Why not every Vercel variable?</span> This page only lists names the
          FastAPI app and its helpers read (<code className="mx-1 font-mono bg-zinc-800 px-1 py-0.5 rounded">api/</code>
          ). Your other keys are still important where they are used.
        </p>
        <p className="text-zinc-400">
          <span className="text-zinc-500">Frontend-only:</span>{' '}
          <code className="font-mono bg-zinc-800 px-1 py-0.5 rounded">REACT_APP_*</code>,{' '}
          <code className="font-mono bg-zinc-800 px-1 py-0.5 rounded">NEXT_PUBLIC_*</code>
          {' '}are baked into the static bundle at build time — this Python runtime does not read them unless you also add them to the API environment.
        </p>
        <p className="text-zinc-400">
          To add or remove rows, edit{' '}
          <code className="font-mono bg-zinc-800 px-1 py-0.5 rounded">_ENV_CHECKLIST</code> in{' '}
          <code className="font-mono bg-zinc-800 px-1 py-0.5 rounded">api/admin_routes.py</code>.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg border border-zinc-800 bg-zinc-900 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800">
          {keysWithHeaders.map((item, idx) =>
            item.type === 'header' ? (
              <div
                key={`h-${item.section}-${idx}`}
                className="px-4 py-2 bg-zinc-900/80 border-b border-zinc-800"
              >
                <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                  {item.section}
                </h2>
              </div>
            ) : (
              <div key={item.name} className="flex items-start justify-between px-4 py-3.5">
                <div className="flex-1 min-w-0 mr-4">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono text-zinc-300">{item.name}</code>
                    {item.configured ? (
                      <CheckCircle size={13} className="text-emerald-500 shrink-0" />
                    ) : (
                      <XCircle size={13} className="text-zinc-600 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {KEY_DESCRIPTIONS[item.name] || 'See codebase for usage.'}
                  </p>
                  {item.last_used && (
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      Last Gemini success (approx.) {new Date(item.last_used).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {item.configured ? (
                    <code className="text-xs font-mono text-zinc-500 bg-zinc-800 px-2 py-1 rounded">
                      {item.masked}
                    </code>
                  ) : (
                    <span className="text-xs text-zinc-600">Not set</span>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
