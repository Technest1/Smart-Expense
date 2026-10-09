import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch, clearToken, getToken, saveToken } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { LAST_SYNC_KEY, SYNC_USER_KEY } from '@/src/services/smsSync';

type User = { user_id: string; email: string; name: string; picture?: string | null };
type AuthState = {
  user: User | null;
  loading: boolean;
  signInWithGoogleIdToken: (t: string, serverAuthCode?: string) => Promise<User>;
  signInWithReviewerCode: (code: string) => Promise<User>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);


// The SMS sync marker belongs to one account. A different account must start from the
// beginning, otherwise its history is skipped and the dashboard stays empty.
async function bindSyncMarkerTo(userId: string) {
  const prev = await storage.getItem<string>(SYNC_USER_KEY, '');
  if (prev && prev !== userId) await storage.removeItem(LAST_SYNC_KEY);
  await storage.setItem(SYNC_USER_KEY, userId);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const t = await getToken();
      if (!t) { setUser(null); return; }
      const data = await apiFetch<{ user: User }>('/auth/me');
      await bindSyncMarkerTo(data.user.user_id);
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

  const signInWithGoogleIdToken = async (id_token: string, serverAuthCode?: string) => {
    const data = await apiFetch<{ session_token: string; user: User }>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ id_token, server_auth_code: serverAuthCode }),
    });
    await saveToken(data.session_token);
    await bindSyncMarkerTo(data.user.user_id);
    setUser(data.user);
    return data.user;
  };

  // Play Store reviewer fallback — see REVIEWER_ACCESS_CODE in backend/server.py.
  const signInWithReviewerCode = async (code: string) => {
    const data = await apiFetch<{ session_token: string; user: User }>('/auth/reviewer-login', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    await saveToken(data.session_token);
    await bindSyncMarkerTo(data.user.user_id);
    setUser(data.user);
    return data.user;
  };

  const signOut = async () => {
    try { await apiFetch('/auth/logout', { method: 'POST' }); } catch {}
    await clearToken();
    setUser(null);
  };

  const deleteAccount = async () => {
    await apiFetch('/auth/account', { method: 'DELETE' });
    await storage.removeItem(LAST_SYNC_KEY);
    await storage.removeItem(SYNC_USER_KEY);
    await clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogleIdToken, signInWithReviewerCode, signOut, deleteAccount, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAuth must be inside AuthProvider');
  return c;
}
