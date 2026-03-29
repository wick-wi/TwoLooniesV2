import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AnalysisProvider } from './context/AnalysisContext';
import { UploadProvider } from './context/UploadContext';
import Landing from './pages/Landing';
import Analysis from './pages/Analysis';
import ResetPassword from './pages/ResetPassword';
import PrivacyPage from './pages/legal/PrivacyPage';
import TermsPage from './pages/legal/TermsPage';
import SubprocessorsPage from './pages/legal/SubprocessorsPage';
import DashboardShell from './components/DashboardShell';
import AdminShell from './components/AdminShell';
import DashboardTab from './pages/dashboard/DashboardTab';
import WealthTab from './pages/dashboard/WealthTab';
import SpendingIncomeTab from './pages/dashboard/SpendingIncomeTab';
import DataEditorTab from './pages/dashboard/DataEditorTab';
import ProfileTab from './pages/dashboard/ProfileTab';
import AdminDashboard from './pages/admin/AdminDashboard';
import ConfigPage from './pages/admin/ConfigPage';
import PromptsPage from './pages/admin/PromptsPage';
import UsersPage from './pages/admin/UsersPage';
import ApiKeysPage from './pages/admin/ApiKeysPage';
import AuditLogPage from './pages/admin/AuditLogPage';
import AnalyticsDashboard from './pages/admin/AnalyticsDashboard';
import ExtractionAnalytics from './pages/admin/ExtractionAnalytics';
import UserAnalytics from './pages/admin/UserAnalytics';
import QueueHealth from './pages/admin/QueueHealth';
function LandingRoute() {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  const hash = location.hash || '';
  const isRecoveryLink = hash.includes('type=recovery');

  // Supabase often redirects password-reset links to Site URL (/) with tokens in the hash.
  // Send the user to the reset-password page so they see the form instead of being sent to dashboard.
  if (location.pathname === '/' && isRecoveryLink) {
    return <Navigate to={`/reset-password${hash}`} replace />;
  }
  if (!loading && isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Landing />;
}

function ProtectedDashboard() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-50">
        Loading...
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to="/" state={{ showLogin: true }} replace />;
  }
  return <DashboardShell />;
}

function ProtectedAdmin() {
  const { isAuthenticated, isAdmin, loading, adminReady } = useAuth();
  if (loading || (isAuthenticated && !adminReady)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-50">
        Loading...
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to="/" state={{ showLogin: true }} replace />;
  }
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }
  return <AdminShell />;
}

function App() {
  return (
    <AuthProvider>
      <AnalysisProvider>
        <UploadProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingRoute />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/legal/subprocessors" element={<SubprocessorsPage />} />
            <Route path="/dashboard" element={<ProtectedDashboard />}>
              <Route index element={<DashboardTab />} />
              <Route path="wealth" element={<WealthTab />} />
              <Route path="spending-income" element={<SpendingIncomeTab />} />
              <Route path="cashflow" element={<Navigate to="/dashboard/spending-income" replace />} />
              <Route path="data-editor" element={<DataEditorTab />} />
              <Route path="profile" element={<ProfileTab />} />
            </Route>
            <Route path="/admin" element={<ProtectedAdmin />}>
              <Route index element={<AdminDashboard />} />
              <Route path="config" element={<ConfigPage />} />
              <Route path="prompts" element={<PromptsPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="api-keys" element={<ApiKeysPage />} />
              <Route path="audit-log" element={<AuditLogPage />} />
              <Route path="analytics" element={<AnalyticsDashboard />} />
              <Route path="analytics/extraction" element={<ExtractionAnalytics />} />
              <Route path="analytics/users" element={<UserAnalytics />} />
              <Route path="queue" element={<QueueHealth />} />
            </Route>
          </Routes>
        </BrowserRouter>
        </UploadProvider>
      </AnalysisProvider>
    </AuthProvider>
  );
}

export default App;
