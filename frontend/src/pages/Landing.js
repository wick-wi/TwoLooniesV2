import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePlaidLink } from 'react-plaid-link';
import axios from 'axios';
import { useAnalysis } from '../context/AnalysisContext';
import { useAuth } from '../context/AuthContext';
import {
  MapPin,
  Shield,
  Zap,
} from 'lucide-react';
import UploadStatementModal from '../components/UploadStatementModal';
import LoginModal from '../components/LoginModal';
import SignUpModal from '../components/SignUpModal';
import ForgotPasswordModal from '../components/ForgotPasswordModal';

const API_BASE = process.env.REACT_APP_API_URL ?? '';

function PlaidButton({ token, onSuccess }) {
  const { open, ready } = usePlaidLink({ token, onSuccess });

  return (
    <button
      className="w-full sm:w-auto px-8 py-3.5 rounded-lg font-semibold text-black bg-gradient-to-r from-amber-400 to-yellow-600 shadow-[0_0_20px_rgba(251,191,36,0.4)] hover:shadow-[0_0_28px_rgba(251,191,36,0.5)] hover:from-amber-300 hover:to-yellow-500 transition-all duration-300 ease-out disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:shadow-[0_0_20px_rgba(251,191,36,0.4)]"
      onClick={() => open()}
      disabled={!ready}
    >
      {ready ? 'Connect Bank Account' : 'Loading Plaid...'}
    </button>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setAnalysisData } = useAnalysis();
  const { isAuthenticated, signOut } = useAuth();
  const [linkToken, setLinkToken] = useState(null);
  const [, setLinkTokenLoading] = useState(true);
  const [linkTokenError, setLinkTokenError] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showSignUpModal, setShowSignUpModal] = useState(false);
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);

  useEffect(() => {
    if (location.state?.showLogin) setShowLoginModal(true);
    if (location.state?.showSignUp) setShowSignUpModal(true);
  }, [location.state?.showLogin, location.state?.showSignUp]);

  const fetchLinkToken = async () => {
    setLinkTokenError(null);
    setLinkTokenLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/create_link_token`);
      setLinkToken(res.data.link_token);
    } catch (err) {
      console.error('Link token error:', err);
      const msg = err.response?.data?.error || err.response?.data?.detail || err.message || 'Could not connect to bank linking service.';
      setLinkTokenError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setLinkTokenLoading(false);
    }
  };

  useEffect(() => {
    fetchLinkToken();
  }, []);

  const onPlaidSuccess = async (public_token) => {
    try {
      const exchangeRes = await axios.post(`${API_BASE}/api/exchange_public_token`, { public_token });
      const access_token = exchangeRes.data?.access_token;
      const item_id = exchangeRes.data?.item_id;
      if (!access_token) throw new Error('No access token returned');
      const txRes = await axios.post(`${API_BASE}/api/transactions`, { access_token });
      if (txRes.data.error) throw new Error(txRes.data.error);
      setAnalysisData({ ...txRes.data, access_token, item_id });
      navigate('/analysis');
    } catch (err) {
      console.error('Plaid flow error:', err);
      alert(err.response?.data?.error || err.message || 'Something went wrong.');
    }
  };

  const onUploadSuccess = (data) => {
    setAnalysisData(data);
    setShowUploadModal(false);
    navigate('/analysis');
  };

  return (
    <div className="min-h-screen bg-[#020617] text-white font-sans relative overflow-hidden">
      {/* Background auras */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-1/2 -left-1/4 w-[800px] h-[800px] rounded-full opacity-10 blur-[120px]"
          style={{ background: '#EAB308' }}
          aria-hidden
        />
        <div
          className="absolute -bottom-1/4 -right-1/4 w-[800px] h-[800px] rounded-full opacity-10 blur-[120px]"
          style={{ background: '#6366F1' }}
          aria-hidden
        />
      </div>

      {/* Header with logo */}
      <header className="relative z-10 pt-8 px-6 sm:px-8 lg:px-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Two Loonie"
              className="h-8 w-auto sm:h-9"
            />
            <span className="font-bold text-lg sm:text-xl tracking-tight">Two Loonie</span>
          </div>
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <>
                <button
                  onClick={() => navigate('/dashboard')}
                  className="px-4 py-2 rounded-lg font-medium text-sm border border-white/20 text-white hover:bg-white/5 transition-colors"
                >
                  Dashboard
                </button>
                <button
                  onClick={() => signOut().then(() => navigate('/'))}
                  className="px-4 py-2 rounded-lg font-medium text-sm text-slate-400 hover:text-white transition-colors"
                >
                  Log out
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowLoginModal(true)}
                className="px-4 py-2 rounded-lg font-medium text-sm border border-white/20 text-white hover:bg-white/5 transition-colors"
              >
                Log in
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex flex-col items-center px-6 sm:px-8 py-12 sm:py-16 lg:py-20">
        {/* Hero */}
        <section className="text-center max-w-2xl mx-auto mb-10 sm:mb-12">
          <img
            src="/logo.png"
            alt="Two Loonie"
            className="h-36 sm:h-[10.5rem] lg:h-48 w-auto mx-auto mb-6 sm:mb-8"
          />
          <h1 className="font-bold text-4xl sm:text-5xl lg:text-6xl tracking-tighter mb-4 sm:mb-5">
            Your Canadian Wealth, Visualized.
          </h1>
          <p className="text-slate-400 text-base sm:text-lg leading-relaxed">
            No spreadsheets. No manual entry. Connect your accounts or drop a PDF to get bank-grade insights into your net worth instantly.
          </p>
        </section>

        {/* Glassmorphic CTA card */}
        <section className="w-full max-w-xl">
          <div className="relative rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 p-8 sm:p-10">
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-stretch sm:items-center">
              {linkToken ? (
                <PlaidButton token={linkToken} onSuccess={onPlaidSuccess} />
              ) : linkTokenError ? (
                <button
                  onClick={fetchLinkToken}
                  className="w-full sm:w-auto px-8 py-3.5 rounded-lg font-semibold text-black bg-gradient-to-r from-amber-400 to-yellow-600 shadow-[0_0_20px_rgba(251,191,36,0.4)] hover:shadow-[0_0_28px_rgba(251,191,36,0.5)] hover:from-amber-300 hover:to-yellow-500 transition-all duration-300 ease-out"
                >
                  Retry Connect Bank
                </button>
              ) : (
                <button
                  disabled
                  className="w-full sm:w-auto px-8 py-3.5 rounded-lg font-semibold text-black bg-gradient-to-r from-amber-400 to-yellow-600 opacity-60 cursor-not-allowed"
                >
                  Loading...
                </button>
              )}
              <button
                onClick={() => setShowUploadModal(true)}
                className="w-full sm:w-auto px-8 py-3.5 rounded-lg font-semibold border border-white/20 text-white hover:bg-white/5 hover:border-white/30 transition-all duration-300 ease-out"
              >
                Upload PDF Statement
              </button>
            </div>
            {linkTokenError && (
              <p className="mt-3 text-center text-amber-400/90 text-sm" role="alert">
                {linkTokenError}
              </p>
            )}
            <p className="mt-5 text-center text-slate-500 text-sm">
              🔒 No account required to start. Your data stays private.
            </p>
          </div>
        </section>

        {/* Feature grid */}
        <section className="w-full max-w-5xl mt-20 sm:mt-24 lg:mt-32 px-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 sm:gap-10">
            <div className="group text-center p-6 rounded-xl hover:bg-white/5 transition-all duration-300 ease-out">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-white/5 text-slate-400 mb-4 group-hover:text-amber-400/90 group-hover:bg-white/10 transition-colors duration-300">
                <MapPin className="w-6 h-6" strokeWidth={1.5} aria-hidden />
              </div>
              <h3 className="font-bold text-lg tracking-tight mb-2">Made for Canada</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Specialized tracking for RRSP, TFSA, and FHSA accounts.
              </p>
            </div>
            <div className="group text-center p-6 rounded-xl hover:bg-white/5 transition-all duration-300 ease-out">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-white/5 text-slate-400 mb-4 group-hover:text-indigo-400/90 group-hover:bg-white/10 transition-colors duration-300">
                <Shield className="w-6 h-6" strokeWidth={1.5} aria-hidden />
              </div>
              <h3 className="font-bold text-lg tracking-tight mb-2">Bank-Level Privacy</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                We use 256-bit encryption. Your credentials are never stored.
              </p>
            </div>
            <div className="group text-center p-6 rounded-xl hover:bg-white/5 transition-all duration-300 ease-out">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-white/5 text-slate-400 mb-4 group-hover:text-emerald-400/90 group-hover:bg-white/10 transition-colors duration-300">
                <Zap className="w-6 h-6" strokeWidth={1.5} aria-hidden />
              </div>
              <h3 className="font-bold text-lg tracking-tight mb-2">Instant Insights</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Stop manual entry. Get a real-time view of your net worth in seconds.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 mt-auto py-8 px-6 sm:px-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-slate-500 text-sm">
            © 2026 Two Loonie. Built with ❤️ in Canada.
          </p>
          <nav className="flex items-center gap-6 text-slate-400 text-sm">
            <a href="#security" className="hover:text-white transition-colors duration-200">Security</a>
            <a href="#privacy" className="hover:text-white transition-colors duration-200">Privacy</a>
            <a href="#faq" className="hover:text-white transition-colors duration-200">FAQ</a>
          </nav>
        </div>
      </footer>

      {showUploadModal && (
        <UploadStatementModal
          onClose={() => setShowUploadModal(false)}
          onSuccess={onUploadSuccess}
        />
      )}

      {showLoginModal && (
        <LoginModal
          onClose={() => {
            setShowLoginModal(false);
            if (location.state?.showLogin) {
              window.history.replaceState({}, '', location.pathname);
            }
          }}
          onSuccess={() => {
            setShowLoginModal(false);
            navigate('/dashboard');
          }}
          switchToSignUp={() => {
            setShowLoginModal(false);
            setShowSignUpModal(true);
          }}
          switchToForgotPassword={() => {
            setShowLoginModal(false);
            setShowForgotPasswordModal(true);
          }}
        />
      )}

      {showForgotPasswordModal && (
        <ForgotPasswordModal
          onClose={() => setShowForgotPasswordModal(false)}
          switchToLogin={() => {
            setShowForgotPasswordModal(false);
            setShowLoginModal(true);
          }}
        />
      )}

      {showSignUpModal && (
        <SignUpModal
          onClose={() => {
            setShowSignUpModal(false);
            if (location.state?.showSignUp) {
              window.history.replaceState({}, '', location.pathname);
            }
          }}
          onSuccess={() => {
            setShowSignUpModal(false);
            navigate('/dashboard');
          }}
          switchToLogin={() => {
            setShowSignUpModal(false);
            setShowLoginModal(true);
          }}
        />
      )}
    </div>
  );
}
