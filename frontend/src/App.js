import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AnalysisProvider } from './context/AnalysisContext';
import { UploadProvider } from './context/UploadContext';
import Landing from './pages/Landing';
import Analysis from './pages/Analysis';
import ResetPassword from './pages/ResetPassword';
import DashboardShell from './components/DashboardShell';
import DashboardTab from './pages/dashboard/DashboardTab';
import WealthTab from './pages/dashboard/WealthTab';
import CashflowTab from './pages/dashboard/CashflowTab';
import DataEditorTab from './pages/dashboard/DataEditorTab';
import ProfileTab from './pages/dashboard/ProfileTab';
import './App.css';

function LandingRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (!loading && isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Landing />;
}

function ProtectedDashboard() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center text-white">
        Loading...
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to="/" state={{ showLogin: true }} replace />;
  }
  return <DashboardShell />;
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
            <Route path="/dashboard" element={<ProtectedDashboard />}>
              <Route index element={<DashboardTab />} />
              <Route path="wealth" element={<WealthTab />} />
              <Route path="cashflow" element={<CashflowTab />} />
              <Route path="data-editor" element={<DataEditorTab />} />
              <Route path="profile" element={<ProfileTab />} />
            </Route>
          </Routes>
        </BrowserRouter>
        </UploadProvider>
      </AnalysisProvider>
    </AuthProvider>
  );
}

export default App;
