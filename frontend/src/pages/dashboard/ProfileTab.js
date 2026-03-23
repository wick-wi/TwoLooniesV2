import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import './ProfileTab.css';

export default function ProfileTab() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!user?.id || !supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('display_name, address')
          .eq('id', user.id)
          .maybeSingle();
        if (error) throw error;
        setDisplayName(data?.display_name ?? '');
        setAddress(data?.address ?? '');
      } catch (err) {
        console.error('Profile fetch error:', err);
        setMessage({ type: 'error', text: 'Could not load profile.' });
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user?.id || !supabase) return;
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await supabase.from('profiles').upsert(
        {
          id: user.id,
          display_name: displayName || null,
          address: address || null,
        },
        { onConflict: 'id' }
      );
      if (error) throw error;
      setMessage({ type: 'success', text: 'Profile saved.' });
    } catch (err) {
      console.error('Profile save error:', err);
      setMessage({ type: 'error', text: err.message || 'Could not save profile.' });
    } finally {
      setSaving(false);
    }
  };

  const email = user?.email ?? '';

  if (loading) {
    return (
      <div className="profile-tab">
        <div className="glass-card profile-tab-card">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="profile-tab">
      <div className="glass-card profile-tab-card">
        <h2 className="profile-tab-title">Profile</h2>
        <form onSubmit={handleSubmit} className="profile-tab-form">
          <div className="profile-tab-field">
            <label htmlFor="profile-email" className="profile-tab-label">
              Email
            </label>
            <input
              id="profile-email"
              type="email"
              value={email}
              readOnly
              className="profile-tab-input profile-tab-input-readonly"
              aria-readonly="true"
            />
          </div>
          <div className="profile-tab-field">
            <label htmlFor="profile-display-name" className="profile-tab-label">
              Display name
            </label>
            <input
              id="profile-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="profile-tab-input"
              placeholder="Your name"
              autoComplete="name"
            />
          </div>
          <div className="profile-tab-field">
            <label htmlFor="profile-address" className="profile-tab-label">
              Address
            </label>
            <textarea
              id="profile-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="profile-tab-input profile-tab-textarea"
              placeholder="Street, city, province, postal code"
              rows={3}
            />
          </div>
          {message && (
            <p
              className={`profile-tab-message ${message.type === 'error' ? 'profile-tab-message-error' : 'profile-tab-message-success'}`}
              role="alert"
            >
              {message.text}
            </p>
          )}
          <button type="submit" className="profile-tab-submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </form>
      </div>

      <div className="glass-card profile-tab-card profile-tab-legal">
        <h3 className="profile-tab-legal-title">Legal & privacy</h3>
        <p className="profile-tab-legal-intro">
          How we handle your data and the rules for using Two Loonies.
        </p>
        <nav className="profile-tab-legal-links" aria-label="Legal">
          <Link to="/privacy" className="profile-tab-legal-link">
            Privacy Policy
          </Link>
          <Link to="/terms" className="profile-tab-legal-link">
            Terms of Use
          </Link>
          <Link to="/legal/subprocessors" className="profile-tab-legal-link">
            Subprocessors
          </Link>
        </nav>
      </div>
    </div>
  );
}
