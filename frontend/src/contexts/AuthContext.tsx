import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch, clearToken, getToken, saveToken } from '@/src/api/client';

type User = { user_id: string; email: string; name: string; picture?: string | null };
type AuthState = {
  user: User | null;
  loading: boolean;
  signInWithGoogleIdToken: (t: string) => Promise<User>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const t = await getToken();
      if (!t) { setUser(null); return; }
      const data = await apiFetch<{ user: User }>('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const signInWithGoogleIdToken = async (id_token: string) => {
    const data = await apiFetch<{ session_token: string; user: User }>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ id_token }),
    });
    await saveToken(data.session_token);
    setUser(data.user);
    return data.user;
  };

  const signOut = async () => {
    try { await apiFetch('/auth/logout', { method: 'POST' }); } catch {}
    await clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogleIdToken, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAuth must be inside AuthProvider');
  return c;
}
