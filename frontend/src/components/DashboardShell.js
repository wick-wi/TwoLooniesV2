import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, PiggyBank, TrendingUp, Database } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ProfileMenu from './ProfileMenu';
import './DashboardShell.css';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/dashboard/wealth', icon: PiggyBank, label: 'Wealth' },
  { to: '/dashboard/cashflow', icon: TrendingUp, label: 'Cashflow' },
  { to: '/dashboard/data-editor', icon: Database, label: 'Data Editor' },
];

export default function DashboardShell() {
  const navigate = useNavigate();
  const { signOut, clearAnalysis } = useAuth();

  const handleLogout = async () => {
    if (clearAnalysis) clearAnalysis();
    await signOut();
    navigate('/');
  };

  return (
    <div className="dashboard-shell">
      {/* Header */}
      <header className="dashboard-shell-header">
        <div className="dashboard-shell-header-inner">
          <div className="flex items-center gap-3">
            <img src="/logo.png?v=2" alt="" className="dashboard-shell-logo" aria-hidden />
            <span className="font-bold text-lg tracking-tight">Two Loonie</span>
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
    </div>
  );
}
