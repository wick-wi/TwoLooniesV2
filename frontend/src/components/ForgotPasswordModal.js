import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './SignUpModal.css';

export default function ForgotPasswordModal({ onClose, switchToLogin }) {
  const { resetPasswordForEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const isValidEmail = (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!email) {
      setError('Please enter your email address.');
      return;
    }
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await resetPasswordForEmail(email);
      setSent(true);
    } catch (err) {
      setError(err.message || 'Failed to send reset link.');
    } finally {
      setLoading(false);
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (sent) {
    return (
      <div className="modal-overlay" onClick={handleOverlayClick}>
        <div className="modal-content signup-modal">
          <div className="modal-header">
            <h2>Check your email</h2>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <div className="modal-body">
            <p className="modal-hint">
              If an account exists for <strong>{email}</strong>, you'll receive a link to reset your password.
            </p>
            <p className="modal-hint" style={{ marginBottom: 0 }}>
              Didn't get an email? Check your spam folder or try again.
            </p>
          </div>
          <div className="modal-footer">
            {switchToLogin && (
              <button type="button" onClick={switchToLogin} className="btn-secondary" style={{ marginRight: 'auto' }}>
                Back to Log in
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-primary">
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content signup-modal">
        <div className="modal-header">
          <h2>Forgot password</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="modal-hint">Enter your email and we'll send you a link to reset your password.</p>
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
            {error && <p className="modal-error">{error}</p>}
          </div>
          <div className="modal-footer">
            {switchToLogin && (
              <button type="button" onClick={switchToLogin} className="btn-secondary" style={{ marginRight: 'auto' }}>
                Back to Log in
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
