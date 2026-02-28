import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './SignUpModal.css';

export default function LoginModal({ onClose, onSuccess, switchToSignUp, switchToForgotPassword }) {
  const { signIn } = useAuth();
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
    setLoading(true);
    try {
      await signIn(email, password);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Login failed.');
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
          <h2>Log In</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="modal-hint">Access your saved analyses and statements.</p>
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
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPassword((v) => !v);
                  }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {switchToForgotPassword && (
                <div className="forgot-password-link-wrapper">
                  <button
                    type="button"
                    onClick={switchToForgotPassword}
                    className="text-sm text-amber-400/90 hover:text-amber-400 font-medium"
                  >
                    Forgot password?
                  </button>
                </div>
              )}
            </label>
            {error && <p className="modal-error">{error}</p>}
          </div>
          <div className="modal-footer">
            {switchToSignUp && (
              <button type="button" onClick={switchToSignUp} className="btn-secondary" style={{ marginRight: 'auto' }}>
                Create account
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Signing in...' : 'Log In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
