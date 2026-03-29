import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getExtractionSummary, getConfidenceDistribution } from '../../utils/adminApi';
import { ResponsiveBar } from '@nivo/bar';
import { ResponsivePie } from '@nivo/pie';
import { RefreshCw } from 'lucide-react';

const PERIOD_OPTIONS = ['7d', '14d', '30d'];

const nivoTheme = {
  background: 'transparent',
  textColor: '#71717a',
  fontSize: 11,
  axis: {
    domain: { line: { stroke: '#3f3f46' } },
    ticks: { line: { stroke: '#3f3f46' }, text: { fill: '#71717a', fontSize: 10 } },
    legend: { text: { fill: '#71717a' } },
  },
  grid: { line: { stroke: '#27272a' } },
  tooltip: { container: { background: '#18181b', border: '1px solid #3f3f46', color: '#e4e4e7', fontSize: 12 } },
};

function LatencyTable({ summary }) {
  if (!summary.length) return <p className="py-8 text-center text-xs text-zinc-600">No data</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="pb-2 text-left text-zinc-500 font-medium">Date</th>
            <th className="pb-2 text-right text-zinc-500 font-medium">Total</th>
            <th className="pb-2 text-right text-zinc-500 font-medium">Errors</th>
            <th className="pb-2 text-right text-zinc-500 font-medium">Error %</th>
            <th className="pb-2 text-right text-zinc-500 font-medium">p50 ms</th>
            <th className="pb-2 text-right text-zinc-500 font-medium">p90 ms</th>
            <th className="pb-2 text-right text-zinc-500 font-medium">p99 ms</th>
            <th className="pb-2 text-right text-zinc-500 font-medium">Cost USD</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((row) => (
            <tr key={row.date} className="border-b border-zinc-800/60">
              <td className="py-1.5 text-zinc-400">{row.date}</td>
              <td className="py-1.5 text-right text-zinc-300 tabular-nums">{row.total}</td>
              <td className="py-1.5 text-right tabular-nums">
                <span className={row.error > 0 ? 'text-red-400' : 'text-zinc-500'}>{row.error}</span>
              </td>
              <td className="py-1.5 text-right tabular-nums">
                <span className={parseFloat(row.error_rate) > 0.05 ? 'text-red-400' : 'text-zinc-400'}>
                  {(row.error_rate * 100).toFixed(1)}%
                </span>
              </td>
              <td className="py-1.5 text-right text-zinc-400 tabular-nums">{row.p50_ms ?? '—'}</td>
              <td className="py-1.5 text-right text-zinc-400 tabular-nums">{row.p90_ms ?? '—'}</td>
              <td className="py-1.5 text-right text-zinc-400 tabular-nums">{row.p99_ms ?? '—'}</td>
              <td className="py-1.5 text-right text-zinc-400 tabular-nums">${(row.cost_usd || 0).toFixed(5)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ExtractionAnalytics() {
  const { getAccessToken } = useAuth();
  const [period, setPeriod] = useState('7d');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState([]);
  const [confidence, setConfidence] = useState(null);

  const load = async () => {
    setLoading(true);
    const token = getAccessToken();
    const [extRes, confRes] = await Promise.allSettled([
      getExtractionSummary(period, token),
      getConfidenceDistribution('30d', token),
    ]);
    if (extRes.status === 'fulfilled') setSummary(extRes.value.data.summary || []);
    if (confRes.status === 'fulfilled') setConfidence(confRes.value.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalCost = summary.reduce((s, d) => s + (d.cost_usd || 0), 0);
  const totalExtractions = summary.reduce((s, d) => s + (d.total || 0), 0);

  const costBarData = summary.map((d) => ({
    date: d.date?.slice(5),
    success: d.success,
    error: d.error,
  }));

  const confPieData = (confidence?.histogram || [])
    .filter((b) => b.count > 0)
    .map((b, i) => ({
      id: b.range,
      label: b.range,
      value: b.count,
      color: i >= 8 ? '#22c55e' : i >= 6 ? '#f59e0b' : '#ef4444',
    }));

  const belowThreshPct = confidence?.total_scored
    ? ((confidence.below_threshold / confidence.total_scored) * 100).toFixed(1)
    : null;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Extraction Telemetry</h1>
          <p className="text-sm text-zinc-500 mt-0.5">AI cost, latency, accuracy, and error rates</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded px-3 py-1 text-xs transition-colors ${
                  period === p ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            className="rounded border border-zinc-700 p-1.5 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Extractions', value: totalExtractions },
          { label: 'Total AI Cost', value: `$${totalCost.toFixed(5)}` },
          { label: 'Below Threshold', value: belowThreshPct ? `${belowThreshPct}%` : '—', sub: 'confidence < 0.8 (30d)' },
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs text-zinc-500 mb-1">{label}</p>
            <p className="text-xl font-semibold text-zinc-100">{loading ? '...' : value}</p>
            {sub && <p className="text-xs text-zinc-600 mt-0.5">{sub}</p>}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="h-56 rounded-lg border border-zinc-800 bg-zinc-900 animate-pulse" />
          <div className="h-56 rounded-lg border border-zinc-800 bg-zinc-900 animate-pulse" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Extraction success/error bar */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-3">Daily Extractions (Success vs Error)</h3>
            {costBarData.length > 0 ? (
              <div style={{ height: 200 }}>
                <ResponsiveBar
                  data={costBarData}
                  keys={['success', 'error']}
                  indexBy="date"
                  margin={{ top: 5, right: 60, bottom: 30, left: 30 }}
                  padding={0.3}
                  colors={['#22c55e', '#dc2626']}
                  theme={nivoTheme}
                  axisBottom={{ tickSize: 0, tickPadding: 6 }}
                  axisLeft={{ tickSize: 0, tickPadding: 6 }}
                  enableLabel={false}
                  borderRadius={2}
                  legends={[{ dataFrom: 'keys', anchor: 'bottom-right', direction: 'column', itemWidth: 55, itemHeight: 16, translateX: 58, symbolSize: 10 }]}
                />
              </div>
            ) : <p className="py-8 text-center text-xs text-zinc-600">No extraction data for this period</p>}
          </div>

          {/* Confidence distribution pie */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-1">Confidence Score Distribution (30d)</h3>
            <p className="text-xs text-zinc-500 mb-3">
              Scores ≥ 0.80 use the LLM category. Scores below become "Uncategorized".
            </p>
            <div className="flex flex-col md:flex-row gap-4">
              {confPieData.length > 0 ? (
                <>
                  <div style={{ height: 220, flex: 1 }}>
                    <ResponsivePie
                      data={confPieData}
                      margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                      innerRadius={0.55}
                      padAngle={1.5}
                      cornerRadius={2}
                      colors={(d) => d.data.color}
                      theme={nivoTheme}
                      enableArcLabels={false}
                      enableArcLinkLabels={false}
                    />
                  </div>
                  <div className="flex-1">
                    <div className="space-y-1">
                      {(confidence?.histogram || []).map((b, i) => (
                        <div key={b.range} className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-sm shrink-0"
                            style={{ backgroundColor: i >= 8 ? '#22c55e' : i >= 6 ? '#f59e0b' : '#ef4444' }}
                          />
                          <span className="text-xs text-zinc-400 w-20 shrink-0">{b.range}</span>
                          <div className="flex-1 bg-zinc-800 rounded-full h-1.5">
                            <div
                              className="h-1.5 rounded-full"
                              style={{
                                width: `${confidence.total_scored ? (b.count / confidence.total_scored) * 100 : 0}%`,
                                backgroundColor: i >= 8 ? '#22c55e' : i >= 6 ? '#f59e0b' : '#ef4444',
                              }}
                            />
                          </div>
                          <span className="text-xs text-zinc-500 w-10 text-right tabular-nums">{b.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <p className="py-8 text-center text-xs text-zinc-600 flex-1">
                  No confidence data yet. Scores are collected when extractions run.
                </p>
              )}
            </div>
          </div>

          {/* Latency table */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-3">Latency & Cost by Day</h3>
            <LatencyTable summary={summary} />
          </div>
        </div>
      )}
    </div>
  );
}
