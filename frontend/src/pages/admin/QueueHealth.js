import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getQueueHealth } from '../../utils/adminApi';
import { CheckCircle, XCircle, Clock, Loader, RefreshCw } from 'lucide-react';

const STATUS_CONFIG = {
  success: { label: 'Succeeded', icon: CheckCircle, color: 'text-emerald-400' },
  error: { label: 'Failed', icon: XCircle, color: 'text-red-400' },
  processing: { label: 'Processing', icon: Loader, color: 'text-blue-400' },
  pending: { label: 'Pending', icon: Clock, color: 'text-zinc-400' },
};

export default function QueueHealth() {
  const { getAccessToken } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const res = await getQueueHealth(getAccessToken());
      setData(res.data);
      setError(null);
    } catch {
      setError('Failed to load queue health.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const queue = data?.queue || {};
  const total = Object.values(queue).reduce((s, v) => s + (v || 0), 0);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Queue Health</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Processing job counts from the last 24 hours
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-zinc-500"
            />
            Auto-refresh (10s)
          </label>
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-lg border border-zinc-800 bg-zinc-900 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {Object.entries(STATUS_CONFIG).map(([status, cfg]) => {
              const count = queue[status] || 0;
              const Icon = cfg.icon;
              return (
                <div key={status} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-zinc-500">{cfg.label}</span>
                    <Icon size={14} className={cfg.color} />
                  </div>
                  <p className={`text-3xl font-semibold ${cfg.color}`}>{count}</p>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-3">Job Breakdown</h3>
            <div className="space-y-2">
              {Object.entries(STATUS_CONFIG).map(([status, cfg]) => {
                const count = queue[status] || 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500 w-24 shrink-0">{cfg.label}</span>
                    <div className="flex-1 bg-zinc-800 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          status === 'success' ? 'bg-emerald-600' :
                          status === 'error' ? 'bg-red-600' :
                          status === 'processing' ? 'bg-blue-600' : 'bg-zinc-600'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-zinc-400 w-8 text-right tabular-nums">{count}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-zinc-600">
              Source: {data?.source || 'extraction_events (last 24h)'}
            </p>
          </div>

          {queue.error > 0 && (
            <div className="mt-4 rounded-lg border border-red-800/40 bg-red-950/20 px-4 py-3">
              <p className="text-sm font-medium text-red-400 mb-1">
                {queue.error} failed extraction{queue.error !== 1 ? 's' : ''} in the last 24 hours
              </p>
              <p className="text-xs text-zinc-500">
                Check the <a href="/admin/analytics/extraction" className="underline text-zinc-400">Extraction Analytics</a> page
                for error details, and the <a href="/admin/audit-log" className="underline text-zinc-400">Audit Log</a> for recent admin changes that may have caused failures.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
