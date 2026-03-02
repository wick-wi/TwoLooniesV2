import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleUser, LogOut, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

export default function ProfileMenu({ onLogout }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const menuRef = useRef(null);

  const fetchDisplayName = React.useCallback(async () => {
    if (!user?.id || !supabase) return;
    const { data } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();
    setDisplayName(data?.display_name?.trim() ?? '');
  }, [user?.id]);

  useEffect(() => {
    fetchDisplayName();
  }, [fetchDisplayName]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const email = user?.email ?? 'Account';
  const label = displayName || 'Profile';

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => {
          if (!open) fetchDisplayName();
          setOpen(!open);
        }}
        className="flex items-center gap-2 p-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-left"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <CircleUser className="w-6 h-6 text-slate-400" strokeWidth={1.5} />
        <span className="text-sm font-medium text-white truncate max-w-[120px]">{label}</span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-56 rounded-xl bg-slate-900/95 backdrop-blur-xl border border-white/10 shadow-xl z-[50] py-1"
          role="menu"
        >
          <div className="px-4 py-3 border-b border-white/10">
            <p className="text-xs text-slate-400">Signed in as</p>
            <p className="text-sm font-medium text-white truncate">{email}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/dashboard/profile');
            }}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
            role="menuitem"
          >
            <User className="w-4 h-4" strokeWidth={1.5} />
            Profile
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
            role="menuitem"
          >
            <LogOut className="w-4 h-4" strokeWidth={1.5} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
