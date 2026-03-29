import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  getAdminPrompts,
  createAdminPrompt,
  activateAdminPrompt,
  deleteAdminPrompt,
} from '../../utils/adminApi';
import { Plus, CheckCircle, Trash2, RefreshCw, Zap, Unplug } from 'lucide-react';
import RuntimeWiredBadge from '../../components/admin/RuntimeWiredBadge';

const PROMPT_KEYS = ['core_extraction', 'categorization'];

function PromptRow({ prompt, onActivate, onDelete }) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 mb-2 ${
        prompt.is_active
          ? 'border-emerald-700 bg-emerald-950/20'
          : 'border-zinc-800 bg-zinc-900'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded">
              v{prompt.version}
            </span>
            {prompt.is_active && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                <CheckCircle size={10} /> Active
              </span>
            )}
            <span className="text-xs text-zinc-600">
              {new Date(prompt.created_at).toLocaleDateString()}
            </span>
          </div>
          {prompt.notes && <p className="text-xs text-zinc-500 mb-1">{prompt.notes}</p>}
          <pre className="text-xs text-zinc-400 whitespace-pre-wrap line-clamp-3 font-mono leading-relaxed">
            {prompt.content}
          </pre>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          {!prompt.is_active && (
            <button
              onClick={() => onActivate(prompt.id)}
              className="rounded border border-emerald-700 px-2 py-1 text-[11px] text-emerald-400 hover:bg-emerald-900/30 transition-colors"
            >
              Activate
            </button>
          )}
          <button
            onClick={() => onDelete(prompt.id)}
            disabled={prompt.is_active}
            className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-500 hover:text-red-400 hover:border-red-700 disabled:opacity-30 transition-colors"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PromptsPage() {
  const { getAccessToken } = useAuth();
  const [prompts, setPrompts] = useState([]);
  const [extractionRuntimeWired, setExtractionRuntimeWired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newPrompt, setNewPrompt] = useState({
    prompt_key: 'core_extraction',
    content: '',
    notes: '',
    is_active: false,
  });

  const load = async () => {
    try {
      setLoading(true);
      const res = await getAdminPrompts(getAccessToken());
      setPrompts(res.data.prompts || []);
      setExtractionRuntimeWired(res.data.extraction_runtime_wired === true);
    } catch {
      setError('Failed to load prompts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = (type, text) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  };

  const handleCreate = async () => {
    if (!newPrompt.content.trim()) return;
    try {
      await createAdminPrompt(newPrompt, getAccessToken());
      setShowNew(false);
      setNewPrompt({ prompt_key: 'core_extraction', content: '', notes: '', is_active: false });
      await load();
      showToast('success', 'Prompt version created');
    } catch {
      showToast('error', 'Failed to create prompt');
    }
  };

  const handleActivate = async (id) => {
    try {
      const res = await activateAdminPrompt(id, getAccessToken());
      if (typeof res.data?.extraction_runtime_wired === 'boolean') {
        setExtractionRuntimeWired(res.data.extraction_runtime_wired);
      }
      await load();
      showToast('success', 'Prompt activated');
    } catch {
      showToast('error', 'Failed to activate');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this prompt version?')) return;
    try {
      await deleteAdminPrompt(id, getAccessToken());
      await load();
      showToast('success', 'Prompt deleted');
    } catch {
      showToast('error', 'Failed to delete');
    }
  };

  // Group by key
  const byKey = {};
  prompts.forEach((p) => {
    if (!byKey[p.prompt_key]) byKey[p.prompt_key] = [];
    byKey[p.prompt_key].push(p);
  });

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-zinc-100">Prompt Versions</h1>
            <RuntimeWiredBadge wired={extractionRuntimeWired} context="prompt" />
          </div>
          <p className="text-sm text-zinc-500 mt-0.5">
            Manage versions in the database. Extraction uses them only when the pipeline is wired to read{' '}
            <code className="text-zinc-600">prompt_versions</code>.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowNew((v) => !v)}
            className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600 transition-colors"
          >
            <Plus size={13} />
            New Version
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-xs text-zinc-400 space-y-2">
        <p className="font-medium text-zinc-300">Extraction runtime</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 items-start">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
              <Zap size={10} /> Live
            </span>
            <span>
              — <code className="text-zinc-500">build_core_extraction_prompt</code> loads the active{' '}
              <code className="text-zinc-500">core_extraction</code> row from the DB.
            </span>
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 items-start">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded border border-zinc-600 bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-500">
              <Unplug size={10} /> Not wired
            </span>
            <span>
              — Current behavior: hardcoded template in{' '}
              <code className="text-zinc-500">api/parsers/prompts.py</code>. Set{' '}
              <code className="text-zinc-500">PROMPT_VERSIONS_WIRED_TO_EXTRACTION = True</code> there after you implement the DB read.
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

      {/* New prompt form */}
      {showNew && (
        <div className="mb-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
          <h2 className="text-sm font-medium text-zinc-300">New Prompt Version</h2>
          <div className="flex gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Prompt Key</label>
              <select
                value={newPrompt.prompt_key}
                onChange={(e) => setNewPrompt((p) => ({ ...p, prompt_key: e.target.value }))}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100"
              >
                {PROMPT_KEYS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-zinc-500 mb-1">Notes</label>
              <input
                value={newPrompt.notes}
                onChange={(e) => setNewPrompt((p) => ({ ...p, notes: e.target.value }))}
                placeholder="e.g. tweaked confidence rules"
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Prompt Content</label>
            <textarea
              value={newPrompt.content}
              onChange={(e) => setNewPrompt((p) => ({ ...p, content: e.target.value }))}
              rows={12}
              placeholder="Paste the full prompt text here..."
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-500 resize-y"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={newPrompt.is_active}
                onChange={(e) => setNewPrompt((p) => ({ ...p, is_active: e.target.checked }))}
                className="accent-emerald-500"
              />
              Activate immediately
            </label>
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => setShowNew(false)}
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newPrompt.content.trim()}
                className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600 disabled:opacity-50 transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 rounded-lg border border-zinc-800 bg-zinc-900 animate-pulse" />
          ))}
        </div>
      ) : Object.keys(byKey).length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 py-12 text-center">
          <p className="text-sm text-zinc-500">No prompt versions yet.</p>
          <p className="text-xs text-zinc-600 mt-1">
            Click "New Version" to create the first hot-swappable prompt.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byKey).map(([key, rows]) => (
            <section key={key}>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
                {key}
              </h2>
              {rows.map((p) => (
                <PromptRow key={p.id} prompt={p} onActivate={handleActivate} onDelete={handleDelete} />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
