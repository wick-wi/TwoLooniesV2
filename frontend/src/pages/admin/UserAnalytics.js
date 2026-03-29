import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getActiveUsers, getUploadVolume } from '../../utils/adminApi';
import { ResponsiveBar } from '@nivo/bar';
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

export default function UserAnalytics() {
  const { getAccessToken } = useAuth();
  const [period, setPeriod] = useState('30d');
  const [loading, setLoading] = useState(true);
  const [usersData, setUsersData] = useState({});
  const [volumeData, setVolumeData] = useState({});

  const load = async () => {
    setLoading(true);
    const token = getAccessToken();
    const [uRes, vRes] = await Promise.allSettled([
      getActiveUsers(period, token),
      getUploadVolume(period, token),
    ]);
    if (uRes.status === 'fulfilled') setUsersData(uRes.value.data);
    if (vRes.status === 'fulfilled') setVolumeData(vRes.value.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  const dauSeries = (usersData.dau_series || []).map((d) => ({
    date: d.date?.slice(5),
    DAU: d.dau,
  }));

  const uploadSeries = (volumeData.volume || []).map((d) => ({
    date: d.date?.slice(5),
    uploads: d.uploads,
  }));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">User Activity</h1>
          <p className="text-sm text-zinc-500 mt-0.5">DAU, MAU, and upload volume trends</p>
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

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'MAU (30d)', value: usersData.mau ?? 0 },
          { label: `Total Uploads (${period})`, value: volumeData.total ?? 0 },
          { label: 'Period', value: period },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs text-zinc-500 mb-1">{label}</p>
            <p className="text-2xl font-semibold text-zinc-100">{loading ? '...' : value}</p>
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
          {/* DAU chart */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-3">Daily Active Users</h3>
            {dauSeries.length > 0 ? (
              <div style={{ height: 220 }}>
                <ResponsiveBar
                  data={dauSeries}
                  keys={['DAU']}
                  indexBy="date"
                  margin={{ top: 5, right: 10, bottom: 35, left: 30 }}
                  padding={0.3}
                  colors={['#4f46e5']}
                  theme={nivoTheme}
                  axisBottom={{ tickSize: 0, tickPadding: 6, tickRotation: -35 }}
                  axisLeft={{ tickSize: 0, tickPadding: 6 }}
                  enableLabel={false}
                  borderRadius={2}
                />
              </div>
            ) : (
              <p className="py-12 text-center text-xs text-zinc-600">
                No activity data yet. DAU is computed from extraction events.
              </p>
            )}
          </div>

          {/* Upload volume */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-3">Daily Upload Volume</h3>
            {uploadSeries.length > 0 ? (
              <div style={{ height: 220 }}>
                <ResponsiveBar
                  data={uploadSeries}
                  keys={['uploads']}
                  indexBy="date"
                  margin={{ top: 5, right: 10, bottom: 35, left: 30 }}
                  padding={0.3}
                  colors={['#0891b2']}
                  theme={nivoTheme}
                  axisBottom={{ tickSize: 0, tickPadding: 6, tickRotation: -35 }}
                  axisLeft={{ tickSize: 0, tickPadding: 6 }}
                  enableLabel={false}
                  borderRadius={2}
                />
              </div>
            ) : (
              <p className="py-12 text-center text-xs text-zinc-600">No upload data for this period</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
