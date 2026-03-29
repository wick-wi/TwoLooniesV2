import React from 'react';
import { Zap, Unplug } from 'lucide-react';

const TOOLTIPS = {
  config: {
    wired: 'The API reads this value from the database when handling requests (within cache TTL).',
    unwired:
      'Stored in Supabase only — extraction/models/flags still use env vars or code defaults until wired in api/utils/admin_config.py (ADMIN_CONFIG_WIRED_KEYS).',
  },
  prompt: {
    wired:
      'Statement extraction loads the active prompt_versions row for core_extraction (see api/parsers/prompts.py).',
    unwired:
      'Versions are saved in Supabase only. build_core_extraction_prompt() still uses the hardcoded template until PROMPT_VERSIONS_WIRED_TO_EXTRACTION is True in api/parsers/prompts.py.',
  },
};

/**
 * @param {boolean} wired
 * @param {'config' | 'prompt'} [context]
 */
export default function RuntimeWiredBadge({ wired, context = 'config' }) {
  const t = TOOLTIPS[context] || TOOLTIPS.config;
  if (wired) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400"
        title={t.wired}
      >
        <Zap size={10} className="shrink-0" />
        Live
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-zinc-600 bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500"
      title={t.unwired}
    >
      <Unplug size={10} className="shrink-0" />
      Not wired
    </span>
  );
}
