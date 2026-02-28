import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import axios from 'axios';
import { useAnalysis } from '../context/AnalysisContext';
import { supabase } from '../lib/supabase';
import './SignUpModal.css';

const API_BASE = process.env.REACT_APP_API_URL ?? '';

export default function SignUpModal({ onClose, onSuccess, switchToLogin }) {
  const { analysis, source, accessToken, itemId, files } = useAnalysis();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isValidEmail = (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError('Please enter email and password.');
      return;
    }
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!supabase) {
      setError('Supabase is not configured. Add REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_PUBLISHABLE_KEY to .env');
      return;
    }
    setLoading(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });
      if (authError) throw authError;
      const token = authData?.session?.access_token;
      if (token) {
        if (files?.length && source === 'pdf') {
          await axios.post(
            `${API_BASE}/api/save_statements`,
            { statements: files },
            { headers: { Authorization: `Bearer ${token}` } }
          );
        }
        if (analysis) {
          await axios.post(
            `${API_BASE}/api/save_analysis`,
            {
              source: source || 'pdf',
              summary: analysis,
              access_token: accessToken || undefined,
              item_id: itemId || undefined,
            },
            { headers: { Authorization: `Bearer ${token}` } }
          );
        }
      }
      onSuccess();
    } catch (err) {
      setError(err.message || err.response?.data?.error || 'Sign up failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content signup-modal">
        <div className="modal-header">
          <h2>Create Account</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="modal-hint">Save your analysis and unlock more features.</p>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            {error && <p className="modal-error">{error}</p>}
          </div>
          <div className="modal-footer">
            {switchToLogin && (
              <button type="button" onClick={switchToLogin} className="btn-secondary" style={{ marginRight: 'auto' }}>
                Already have an account? Log in
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Creating account...' : 'Sign Up'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
