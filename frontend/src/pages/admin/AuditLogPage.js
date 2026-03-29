import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getAuditLog } from '../../utils/adminApi';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

const ACTION_COLORS = {
  config_update: 'text-blue-400',
  prompt_create: 'text-emerald-400',
  prompt_activate: 'text-emerald-500',
  prompt_delete: 'text-red-400',
  user_hard_delete: 'text-red-500',
};

export default function AuditLogPage() {
  const { getAccessToken } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAuditLog({ page, page_size: PAGE_SIZE }, getAccessToken());
      setLogs(res.data.logs || []);
    } catch {
      setError('Failed to load audit log.');
    } finally {
      setLoading(false);
    }
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Audit Log</h1>
          <p className="text-sm text-zinc-500 mt-0.5">All admin actions, newest first</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/60">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Time</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Action</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Target</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Admin ID</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-zinc-800 animate-pulse">
                  {[...Array(5)].map((__, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-zinc-800 rounded" /></td>
                  ))}
                </tr>
              ))
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-zinc-500">
                  No audit log entries yet.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b border-zinc-800 bg-zinc-950 hover:bg-zinc-900 transition-colors">
                  <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${ACTION_COLORS[log.action] || 'text-zinc-300'}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400">
                    {log.target_type && <span className="text-zinc-600">{log.target_type}/</span>}
                    {log.target_id?.slice(0, 16)}
                    {log.target_id?.length > 16 ? '…' : ''}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-600 truncate max-w-[120px]">
                    {log.admin_id?.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500 max-w-xs truncate">
                    {log.details ? JSON.stringify(log.details).slice(0, 80) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
        <span>Page {page}</span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded border border-zinc-800 px-2 py-1 hover:border-zinc-700 disabled:opacity-30"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={logs.length < PAGE_SIZE}
            className="rounded border border-zinc-800 px-2 py-1 hover:border-zinc-700 disabled:opacity-30"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
