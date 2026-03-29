import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  getExtractionSummary,
  getUploadVolume,
  getActiveUsers,
  getErrorRates,
} from '../../utils/adminApi';
import { ResponsiveBar } from '@nivo/bar';
import { Cpu, Upload, Users, AlertTriangle } from 'lucide-react';

const PERIOD_OPTIONS = ['7d', '14d', '30d'];

function MetricCard({ label, value, sub, icon: Icon, to, colorClass = 'text-zinc-100' }) {
  const inner = (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-700 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-zinc-500 uppercase tracking-wide">{label}</span>
        {Icon && <Icon size={14} className="text-zinc-600" />}
      </div>
      <p className={`text-2xl font-semibold ${colorClass}`}>{value ?? '—'}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function ChartCard({ title, children, to }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-300">{title}</h3>
        {to && <Link to={to} className="text-xs text-zinc-500 hover:text-zinc-300">Details →</Link>}
      </div>
      {children}
    </div>
  );
}

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

export default function AnalyticsDashboard() {
  const { getAccessToken } = useAuth();
  const [period, setPeriod] = useState('7d');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({});

  useEffect(() => {
    const token = getAccessToken();
    setLoading(true);
    Promise.allSettled([
      getExtractionSummary(period, token),
      getUploadVolume(period, token),
      getActiveUsers(period, token),
      getErrorRates(period, token),
    ]).then(([extRes, volRes, usersRes, errRes]) => {
      setData({
        extraction: extRes.status === 'fulfilled' ? extRes.value.data : {},
        volume: volRes.status === 'fulfilled' ? volRes.value.data : {},
        users: usersRes.status === 'fulfilled' ? usersRes.value.data : {},
        errors: errRes.status === 'fulfilled' ? errRes.value.data : {},
      });
    }).finally(() => setLoading(false));
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  const extSummary = data.extraction?.summary || [];
  const totalCost = extSummary.reduce((s, d) => s + (d.cost_usd || 0), 0);
  const totalExtractions = extSummary.reduce((s, d) => s + (d.total || 0), 0);
  const totalErrors = extSummary.reduce((s, d) => s + (d.error || 0), 0);
  const avgErrorRate = totalExtractions ? (totalErrors / totalExtractions * 100).toFixed(1) : '0.0';

  const uploadData = (data.volume?.volume || []).map((d) => ({ date: d.date?.slice(5), uploads: d.uploads }));
  const costData = extSummary.map((d) => ({ date: d.date?.slice(5), cost: parseFloat((d.cost_usd || 0).toFixed(5)) }));
  const errData = (data.errors?.error_rates || []).map((d) => ({ date: d.date?.slice(5), '4xx': d['4xx'] || 0, '5xx': d['5xx'] || 0 }));
  const dauData = (data.users?.dau_series || []).map((d) => ({ date: d.date?.slice(5), DAU: d.dau }));

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Analytics Overview</h1>
          <p className="text-sm text-zinc-500 mt-0.5">System health, costs, and user engagement</p>
        </div>
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
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Total Extractions" value={loading ? '...' : totalExtractions} icon={Cpu} to="/admin/analytics/extraction" />
        <MetricCard label="Total Uploads" value={loading ? '...' : (data.volume?.total ?? 0)} icon={Upload} to="/admin/analytics" />
        <MetricCard label="MAU" value={loading ? '...' : (data.users?.mau ?? 0)} icon={Users} to="/admin/analytics/users" />
        <MetricCard
          label="Extraction Errors"
          value={loading ? '...' : `${avgErrorRate}%`}
          sub={`${totalErrors} of ${totalExtractions}`}
          icon={AlertTriangle}
          colorClass={parseFloat(avgErrorRate) > 5 ? 'text-red-400' : 'text-zinc-100'}
          to="/admin/analytics/extraction"
        />
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-56 rounded-lg border border-zinc-800 bg-zinc-900 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Upload Volume */}
          <ChartCard title="Upload Volume" to="/admin/analytics">
            {uploadData.length > 0 ? (
              <div style={{ height: 200 }}>
                <ResponsiveBar
                  data={uploadData}
                  keys={['uploads']}
                  indexBy="date"
                  margin={{ top: 5, right: 10, bottom: 30, left: 30 }}
                  padding={0.3}
                  colors={['#52525b']}
                  theme={nivoTheme}
                  axisBottom={{ tickSize: 0, tickPadding: 6 }}
                  axisLeft={{ tickSize: 0, tickPadding: 6 }}
                  enableLabel={false}
                  borderRadius={2}
                />
              </div>
            ) : <p className="py-12 text-center text-xs text-zinc-600">No data for this period</p>}
          </ChartCard>

          {/* AI Cost */}
          <ChartCard title={`AI Cost (USD) — total $${totalCost.toFixed(4)}`} to="/admin/analytics/extraction">
            {costData.length > 0 ? (
              <div style={{ height: 200 }}>
                <ResponsiveBar
                  data={costData}
                  keys={['cost']}
                  indexBy="date"
                  margin={{ top: 5, right: 10, bottom: 30, left: 50 }}
                  padding={0.3}
                  colors={['#a16207']}
                  theme={nivoTheme}
                  axisBottom={{ tickSize: 0, tickPadding: 6 }}
                  axisLeft={{ tickSize: 0, tickPadding: 6, format: (v) => `$${v}` }}
                  enableLabel={false}
                  borderRadius={2}
                />
              </div>
            ) : <p className="py-12 text-center text-xs text-zinc-600">No cost data yet</p>}
          </ChartCard>

          {/* API Error Rates */}
          <ChartCard title="API Errors by Day" to="/admin/analytics/extraction">
            {errData.length > 0 ? (
              <div style={{ height: 200 }}>
                <ResponsiveBar
                  data={errData}
                  keys={['4xx', '5xx']}
                  indexBy="date"
                  margin={{ top: 5, right: 60, bottom: 30, left: 30 }}
                  padding={0.3}
                  colors={['#78716c', '#dc2626']}
                  theme={nivoTheme}
                  axisBottom={{ tickSize: 0, tickPadding: 6 }}
                  axisLeft={{ tickSize: 0, tickPadding: 6 }}
                  enableLabel={false}
                  borderRadius={2}
                  legends={[{ dataFrom: 'keys', anchor: 'bottom-right', direction: 'column', itemWidth: 50, itemHeight: 16, translateX: 58, symbolSize: 10 }]}
                />
              </div>
            ) : <p className="py-12 text-center text-xs text-zinc-600">No error data yet</p>}
          </ChartCard>

          {/* DAU */}
          <ChartCard title="Daily Active Users (DAU)" to="/admin/analytics/users">
            {dauData.length > 0 ? (
              <div style={{ height: 200 }}>
                <ResponsiveBar
                  data={dauData}
                  keys={['DAU']}
                  indexBy="date"
                  margin={{ top: 5, right: 10, bottom: 30, left: 30 }}
                  padding={0.3}
                  colors={['#4f46e5']}
                  theme={nivoTheme}
                  axisBottom={{ tickSize: 0, tickPadding: 6 }}
                  axisLeft={{ tickSize: 0, tickPadding: 6 }}
                  enableLabel={false}
                  borderRadius={2}
                />
              </div>
            ) : <p className="py-12 text-center text-xs text-zinc-600">No activity data yet</p>}
          </ChartCard>
        </div>
      )}
    </div>
  );
}
