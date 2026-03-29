import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Settings,
  FileText,
  Users,
  Key,
  BarChart2,
  Activity,
  UserCheck,
  ChevronLeft,
  LogOut,
  ClipboardList,
  Cpu,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const navSections = [
  {
    label: 'Overview',
    items: [
      { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { to: '/admin/config', icon: Settings, label: 'System Config' },
      { to: '/admin/prompts', icon: FileText, label: 'Prompt Versions' },
      { to: '/admin/api-keys', icon: Key, label: 'API Keys' },
    ],
  },
  {
    label: 'Users',
    items: [
      { to: '/admin/users', icon: Users, label: 'User Management' },
      { to: '/admin/audit-log', icon: ClipboardList, label: 'Audit Log' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { to: '/admin/analytics', icon: BarChart2, label: 'Overview' },
      { to: '/admin/analytics/extraction', icon: Cpu, label: 'Extraction Telemetry' },
      { to: '/admin/analytics/users', icon: UserCheck, label: 'User Activity' },
      { to: '/admin/queue', icon: Activity, label: 'Queue Health' },
    ],
  },
];

export default function AdminShell() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      {/* Sidebar */}
      <aside
        className={`flex flex-col border-r border-zinc-800 bg-zinc-900 transition-all duration-200 ${
          sidebarOpen ? 'w-56' : 'w-14'
        }`}
      >
        {/* Sidebar header */}
        <div className="flex h-14 items-center justify-between px-3 border-b border-zinc-800">
          {sidebarOpen && (
            <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
              Admin
            </span>
          )}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
            aria-label="Toggle sidebar"
          >
            <ChevronLeft
              size={16}
              className={`transition-transform ${sidebarOpen ? '' : 'rotate-180'}`}
            />
          </button>
        </div>

        {/* Nav sections */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-4">
          {navSections.map((section) => (
            <div key={section.label}>
              {sidebarOpen && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  {section.label}
                </p>
              )}
              {section.items.map(({ to, icon: Icon, label, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-md mx-1.5 px-2 py-1.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                    }`
                  }
                >
                  <Icon size={16} strokeWidth={1.5} className="shrink-0" />
                  {sidebarOpen && <span className="truncate">{label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-zinc-800 p-2 space-y-1">
          <NavLink
            to="/dashboard"
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 transition-colors"
          >
            <LayoutDashboard size={16} strokeWidth={1.5} className="shrink-0" />
            {sidebarOpen && <span>Back to App</span>}
          </NavLink>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800/60 hover:text-red-400 transition-colors"
          >
            <LogOut size={16} strokeWidth={1.5} className="shrink-0" />
            {sidebarOpen && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
