import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  getAdminConfig,
  getUploadVolume,
  getExtractionSummary,
  getActiveUsers,
  getQueueHealth,
} from '../../utils/adminApi';
import { Activity, Upload, Users, AlertTriangle, Settings, FileText, Cpu } from 'lucide-react';

function StatCard({ label, value, sub, icon: Icon, to, colorClass = 'text-zinc-100' }) {
  const inner = (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-700 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-zinc-500 uppercase tracking-wide">{label}</span>
        {Icon && <Icon size={16} className="text-zinc-600" />}
      </div>
      <p className={`text-2xl font-semibold ${colorClass}`}>{value ?? '—'}</p>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

export default function AdminDashboard() {
  const { getAccessToken } = useAuth();
  const [stats, setStats] = useState(null);
  const [maintenance, setMaintenance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const token = getAccessToken();
    const load = async () => {
      try {
        const [configRes, volumeRes, extractRes, usersRes, queueRes] = await Promise.allSettled([
          getAdminConfig(token),
          getUploadVolume('7d', token),
          getExtractionSummary('7d', token),
          getActiveUsers('30d', token),
          getQueueHealth(token),
        ]);

        const config = configRes.status === 'fulfilled' ? configRes.value.data.config : [];
        const maintRow = config.find((r) => r.key === 'maintenance_mode');
        setMaintenance(maintRow?.value === true || maintRow?.value === 'true');

        const volume = volumeRes.status === 'fulfilled' ? volumeRes.value.data : {};
        const extract = extractRes.status === 'fulfilled' ? extractRes.value.data : {};
        const users = usersRes.status === 'fulfilled' ? usersRes.value.data : {};
        const queue = queueRes.status === 'fulfilled' ? queueRes.value.data : {};

        const last7Days = extract.summary || [];
        const totalCost = last7Days.reduce((s, d) => s + (d.cost_usd || 0), 0);
        const totalErrors = last7Days.reduce((s, d) => s + (d.error || 0), 0);
        const totalExtractions = last7Days.reduce((s, d) => s + (d.total || 0), 0);
        const errorRate = totalExtractions
          ? ((totalErrors / totalExtractions) * 100).toFixed(1)
          : '0.0';

        setStats({
          uploadsToday: (volume.volume || []).find(
            (v) => v.date === new Date().toISOString().slice(0, 10)
          )?.uploads ?? 0,
          totalUploads7d: volume.total || 0,
          mau: users.mau || 0,
          costUsd7d: totalCost.toFixed(4),
          errorRate,
          queueErrors: queue.queue?.error || 0,
          queueSuccess: queue.queue?.success || 0,
        });
      } catch (e) {
        setError('Failed to load dashboard stats');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Admin Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Mission control for Two Loonies</p>
        </div>
        {maintenance === true && (
          <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 border border-amber-500/30">
            <AlertTriangle size={12} />
            Maintenance Mode Active
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 rounded-lg border border-zinc-800 bg-zinc-900 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard label="Uploads Today" value={stats?.uploadsToday} icon={Upload} to="/admin/analytics" />
          <StatCard label="Uploads (7d)" value={stats?.totalUploads7d} icon={Upload} to="/admin/analytics" />
          <StatCard label="MAU (30d)" value={stats?.mau} icon={Users} to="/admin/analytics/users" />
          <StatCard
            label="AI Cost (7d)"
            value={`$${stats?.costUsd7d}`}
            icon={Cpu}
            to="/admin/analytics/extraction"
            colorClass={parseFloat(stats?.costUsd7d) > 1 ? 'text-amber-400' : 'text-zinc-100'}
          />
          <StatCard
            label="Error Rate (7d)"
            value={`${stats?.errorRate}%`}
            icon={AlertTriangle}
            to="/admin/analytics/extraction"
            colorClass={parseFloat(stats?.errorRate) > 5 ? 'text-red-400' : 'text-zinc-100'}
          />
          <StatCard
            label="Queue Errors (24h)"
            value={stats?.queueErrors}
            icon={Activity}
            to="/admin/queue"
            colorClass={stats?.queueErrors > 0 ? 'text-red-400' : 'text-zinc-100'}
          />
        </div>
      )}

      {/* Quick links */}
      <div className="mt-8">
        <h2 className="text-sm font-medium text-zinc-400 mb-3">Quick actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { to: '/admin/config', icon: Settings, label: 'System Config' },
            { to: '/admin/prompts', icon: FileText, label: 'Prompt Versions' },
            { to: '/admin/users', icon: Users, label: 'Manage Users' },
            { to: '/admin/analytics', icon: Activity, label: 'Analytics' },
          ].map(({ to, icon: Icon, label }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-300 hover:border-zinc-700 hover:text-zinc-100 transition-colors"
            >
              <Icon size={15} strokeWidth={1.5} />
              {label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
