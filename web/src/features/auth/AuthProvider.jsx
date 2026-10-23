import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore, UNAUTHORIZED_EVENT } from '@/lib/api';

const AuthContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }) {
  const qc = useQueryClient();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => !!tokenStore.get());

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    qc.clear();
  }, [qc]);

  // Restore the session on first load.
  useEffect(() => {
    if (!tokenStore.get()) return;
    api
      .get('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  // Any API call that comes back 401 (expired token) signs the user out.
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, logout);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, logout);
  }, [logout]);

  const accept = useCallback(
    (r) => {
      tokenStore.set(r.token);
      qc.clear();
      setUser(r.user);
      return r.user;
    },
    [qc],
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      logout,
      login: async (email, password) => accept(await api.post('/auth/login', { email, password })),
      register: async (input) => accept(await api.post('/auth/register', input)),
    }),
    [user, loading, logout, accept],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
