import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AnalysisProvider } from './context/AnalysisContext';
import Landing from './pages/Landing';
import Analysis from './pages/Analysis';
import Dashboard from './pages/Dashboard';
import ResetPassword from './pages/ResetPassword';
import './App.css';

function LandingRoute() {
  const { isAuthenticated, loading } = useAuth();
  // Don't block on loading - show Landing; redirect only when we know user is logged in
  if (!loading && isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Landing />;
}

function App() {
  return (
    <AuthProvider>
      <AnalysisProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingRoute />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/reset-password" element={<ResetPassword />} />
          </Routes>
        </BrowserRouter>
      </AnalysisProvider>
    </AuthProvider>
  );
}

export default App;
