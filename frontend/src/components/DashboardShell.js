import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, PiggyBank, TrendingUp, Database, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useAnalysis } from '../context/AnalysisContext';
import ProfileMenu from './ProfileMenu';
import LoonieChat from './LoonieChat';
import './DashboardShell.css';

const API_BASE = process.env.REACT_APP_API_BASE || '';

function useSystemStatus() {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [loonieAiEnabled, setLoonieAiEnabled] = useState(true);
  useEffect(() => {
    axios
      .get(`${API_BASE}/api/system/status`)
      .then((res) => {
        setMaintenanceMode(res.data?.maintenance_mode === true);
        setLoonieAiEnabled(res.data?.loonie_ai_enabled !== false);
      })
      .catch(() => {});
  }, []);
  return { maintenanceMode, loonieAiEnabled };
}

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/dashboard/wealth', icon: PiggyBank, label: 'Wealth' },
  { to: '/dashboard/spending-income', icon: TrendingUp, label: 'Spending & Income' },
  { to: '/dashboard/data-editor', icon: Database, label: 'Data Editor' },
];

export default function DashboardShell() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { clearAnalysis } = useAnalysis();
  const { maintenanceMode, loonieAiEnabled } = useSystemStatus();

  const handleLogout = async () => {
    if (clearAnalysis) clearAnalysis();
    await signOut();
    navigate('/');
  };

  return (
    <div className="dashboard-shell">
      {/* Maintenance mode banner */}
      {maintenanceMode && (
        <div className="flex items-center justify-center gap-2 bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-400">
          <AlertTriangle size={12} />
          File uploads are temporarily paused for maintenance. The dashboard remains read-only.
        </div>
      )}

      {/* Header */}
      <header className="dashboard-shell-header">
        <div className="dashboard-shell-header-inner">
          <div className="flex items-center gap-3">
            <img src="/logo.png?v=2" alt="" className="dashboard-shell-logo" aria-hidden />
            <span className="font-bold text-lg tracking-tight">Two Loonies</span>
          </div>
          <ProfileMenu onLogout={handleLogout} />
        </div>
      </header>

      {/* Main content - pb-28 for bottom nav clearance */}
      <main className="dashboard-shell-main">
        <Outlet />
      </main>

      {/* Fixed bottom navigation - z-40 */}
      <nav className="dashboard-shell-nav" aria-label="Main navigation">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/dashboard'}
            className={({ isActive }) =>
              `dashboard-shell-nav-link ${isActive ? 'dashboard-shell-nav-link-active' : ''}`
            }
          >
            <Icon className="dashboard-shell-nav-icon" strokeWidth={1.5} aria-hidden />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Loonie AI chat - available across all dashboard tabs */}
      {loonieAiEnabled && <LoonieChat />}
    </div>
  );
}
