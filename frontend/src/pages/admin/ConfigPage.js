import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getAdminConfig, updateAdminConfig } from '../../utils/adminApi';
import { Save, RefreshCw, AlertTriangle, Zap, Unplug } from 'lucide-react';
import RuntimeWiredBadge from '../../components/admin/RuntimeWiredBadge';

const CONFIG_META = {
  gemini_model_pass1: {
    label: 'Gemini Model (Pass 1)',
    type: 'text',
    group: 'AI Models',
    description: 'Primary extraction model. e.g. gemini-2.5-flash-lite',
  },
  gemini_model_pass2: {
    label: 'Gemini Model (Pass 2)',
    type: 'text',
    group: 'AI Models',
    description: 'Fallback model used when pass 1 validation fails.',
  },
  statement_parser: {
    label: 'Statement Parser',
    type: 'select',
    options: ['pdfplumber', 'pdfplumber_v2', 'gemini_native', 'docling'],
    group: 'AI Models',
    description: 'PDF extraction backend.',
  },
  enable_pass3: {
    label: 'Enable Pass 3 (Docling)',
    type: 'toggle',
    group: 'AI Models',
    description: 'Use Docling as a third-pass fallback when both LLM passes fail validation.',
  },
  confidence_threshold: {
    label: 'Confidence Threshold',
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.05,
    group: 'Extraction',
    description: 'Minimum LLM confidence to accept a category. Transactions below this become "Uncategorized".',
  },
  maintenance_mode: {
    label: 'Maintenance Mode',
    type: 'toggle',
    group: 'System',
    description: 'When enabled, new file uploads are paused with a 503 response.',
    danger: true,
  },
  max_uploads_per_hour: {
    label: 'Max Uploads / Hour',
    type: 'number',
    group: 'System',
    description: 'Per-user upload rate limit. Applies when Redis rate limiting is enabled.',
  },
  max_statement_file_size_bytes: {
    label: 'Max File Size (bytes)',
    type: 'number',
    group: 'System',
    description: 'Maximum allowed PDF/CSV file size in bytes (default 5 242 880 = 5 MB).',
  },
  flag_plaid_enabled: {
    label: 'Plaid Bank Linking',
    type: 'toggle',
    group: 'Feature Flags',
    description: 'Enable or disable the Plaid bank account linking feature.',
  },
  flag_csv_upload_enabled: {
    label: 'CSV Uploads',
    type: 'toggle',
    group: 'Feature Flags',
    description: 'Enable or disable CSV statement uploads.',
  },
  flag_hard_delete_enabled: {
    label: 'Hard Delete (Admin)',
    type: 'toggle',
    group: 'Feature Flags',
    description: 'Show the GDPR hard-delete button in the admin user management panel.',
  },
  loonie_ai_enabled: {
    label: 'Loonie AI (chat)',
    type: 'toggle',
    group: 'Feature Flags',
    description: 'When off, the Loonie assistant is hidden for all users and chat requests return unavailable.',
  },
};

function ConfigField({ row, onSave, saving }) {
  const meta = CONFIG_META[row.key] || { type: 'text', label: row.key };
  const [localValue, setLocalValue] = useState(() => {
    const v = row.value;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const trimmed = v.replace(/^"|"$/g, '');
      return trimmed;
    }
    return v ?? '';
  });
  const [dirty, setDirty] = useState(false);

  const handleChange = (val) => {
    setLocalValue(val);
    setDirty(true);
  };

  const handleSave = () => {
    let saveVal = localValue;
    if (meta.type === 'toggle') saveVal = localValue;
    else if (meta.type === 'slider' || meta.type === 'number') saveVal = Number(localValue);
    onSave(row.key, saveVal);
    setDirty(false);
  };

  const renderInput = () => {
    if (meta.type === 'toggle') {
      return (
        <button
          onClick={() => handleChange(!localValue)}
          className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${
            localValue ? (meta.danger ? 'bg-amber-500' : 'bg-emerald-600') : 'bg-zinc-700'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
              localValue ? 'translate-x-5.5' : 'translate-x-0.5'
            }`}
          />
        </button>
      );
    }
    if (meta.type === 'select') {
      return (
        <select
          value={localValue}
          onChange={(e) => handleChange(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
        >
          {meta.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    if (meta.type === 'slider') {
      return (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={meta.min}
            max={meta.max}
            step={meta.step}
            value={localValue}
            onChange={(e) => handleChange(parseFloat(e.target.value))}
            className="w-40 accent-zinc-400"
          />
          <span className="w-10 text-center text-sm text-zinc-300 tabular-nums">{Number(localValue).toFixed(2)}</span>
        </div>
      );
    }
    return (
      <input
        type={meta.type === 'number' ? 'number' : 'text'}
        value={localValue}
        onChange={(e) => handleChange(meta.type === 'number' ? Number(e.target.value) : e.target.value)}
        className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 w-64"
      />
    );
  };

  return (
    <div className="flex items-start justify-between py-3.5 border-b border-zinc-800 last:border-0">
      <div className="flex-1 min-w-0 mr-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-zinc-200">{meta.label}</span>
          <RuntimeWiredBadge wired={row.runtime_wired === true} context="config" />
          {meta.danger && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400 border border-amber-500/30 rounded px-1.5 py-0.5">
              <AlertTriangle size={10} /> Danger
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 mt-0.5">{meta.description || row.key}</p>
        {row.updated_at && (
          <p className="text-[10px] text-zinc-600 mt-0.5">
            Last updated {new Date(row.updated_at).toLocaleString()}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {renderInput()}
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-600 disabled:opacity-50 transition-colors"
          >
            <Save size={12} />
            Save
          </button>
        )}
      </div>
    </div>
  );
}

export default function ConfigPage() {
  const { getAccessToken } = useAuth();
  const [config, setConfig] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const token = getAccessToken();
      const res = await getAdminConfig(token);
      setConfig(res.data.config || []);
    } catch (e) {
      setError('Failed to load config. Make sure you have admin access.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (key, value) => {
    setSaving(true);
    try {
      const token = getAccessToken();
      await updateAdminConfig(key, value, token);
      setConfig((prev) => prev.map((r) => (r.key === key ? { ...r, value } : r)));
      setToast({ type: 'success', text: `${key} updated` });
    } catch (e) {
      setToast({ type: 'error', text: `Failed to update ${key}` });
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  // Group config by meta group
  const groups = {};
  config.forEach((row) => {
    const g = CONFIG_META[row.key]?.group || 'Other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(row);
  });

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">System Configuration</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Hot-swap runtime settings without redeploying</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-xs text-zinc-400 space-y-2">
        <p className="font-medium text-zinc-300">Runtime wiring</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
              <Zap size={10} /> Live
            </span>
            <span>— API uses this DB value (see <code className="text-zinc-500">get_admin_config*</code>).</span>
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded border border-zinc-600 bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-500">
              <Unplug size={10} /> Not wired
            </span>
            <span>
              — Saved here only; behavior still follows env / <code className="text-zinc-500">config.json</code> / code. Extend{' '}
              <code className="text-zinc-500">ADMIN_CONFIG_WIRED_KEYS</code> in{' '}
              <code className="text-zinc-500">api/utils/admin_config.py</code> when you hook a key up.
            </span>
          </span>
        </div>
      </div>

      {toast && (
        <div
          className={`mb-4 rounded border px-4 py-2.5 text-sm ${
            toast.type === 'success'
              ? 'border-emerald-700 bg-emerald-950/30 text-emerald-400'
              : 'border-red-700 bg-red-950/30 text-red-400'
          }`}
        >
          {toast.text}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-14 rounded-lg border border-zinc-800 bg-zinc-900 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([groupName, rows]) => (
            <section key={groupName}>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
                {groupName}
              </h2>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4">
                {rows.map((row) => (
                  <ConfigField key={row.key} row={row} onSave={handleSave} saving={saving} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
