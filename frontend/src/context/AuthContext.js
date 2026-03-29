import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

async function fetchIsAdmin(userId) {
  if (!supabase || !userId) return false;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.warn('Could not load is_admin from profiles:', error.message);
      return false;
    }
    return data?.is_admin === true;
  } catch (e) {
    console.warn('Could not load is_admin from profiles:', e?.message || e);
    return false;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  /** False until we've finished the profiles lookup for the current session user (or know there is none). */
  const [adminReady, setAdminReady] = useState(false);
  const adminCheckUserRef = useRef(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setAdminReady(true);
      return;
    }
    const runAdminCheck = (userId) => {
      if (!userId) {
        adminCheckUserRef.current = null;
        setIsAdmin(false);
        setAdminReady(true);
        return;
      }
      // getSession + INITIAL_SESSION both call this; avoid resetting adminReady mid-flight for the same user.
      if (adminCheckUserRef.current === userId) {
        return;
      }
      adminCheckUserRef.current = userId;
      setAdminReady(false);
      fetchIsAdmin(userId)
        .then(setIsAdmin)
        .catch(() => setIsAdmin(false))
        .finally(() => setAdminReady(true));
    };

    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        setSession(s);
        setUser(s?.user ?? null);
        // Do not await fetchIsAdmin on getSession's promise chain — it would block setLoading(false).
        runAdminCheck(s?.user?.id);
      })
      .catch((err) => {
        console.error('Auth session check failed:', err);
        setSession(null);
        setUser(null);
        setIsAdmin(false);
        setAdminReady(true);
      })
      .finally(() => {
        setLoading(false);
      });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      runAdminCheck(s?.user?.id);
    });
    return () => subscription?.unsubscribe();
  }, []);

  const signIn = async (email, password) => {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const signUp = async (email, password) => {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const resetPasswordForEmail = async (email) => {
    if (!supabase) throw new Error('Supabase not configured');
    const redirectTo = `${window.location.origin}/reset-password`;
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    return data;
  };

  const updatePassword = async (newPassword) => {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return data;
  };

  const getAccessToken = () => session?.access_token ?? null;

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        loading,
        adminReady,
        isAuthenticated: !!session,
        isAdmin,
        signIn,
        signUp,
        signOut,
        resetPasswordForEmail,
        updatePassword,
        getAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
