import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, UNAUTHORIZED_EVENT } from '@/lib/api';
import { useRealtimeSync } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';
import type { User } from '@/lib/types';

export interface RegisterInput {
  name: string; email: string; password: string; studentId: string;
  university?: string; course?: string; yearOfStudy?: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Turn a Supabase Auth error into the same ApiError the rest of the app already knows how to show. */
function toApiError(error: { message: string; status?: number; code?: string; name?: string }): ApiError {
  if (error.code === 'invalid_credentials' || error.message === 'Invalid login credentials') {
    return new ApiError(401, 'Incorrect email or password.');
  }
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) {
    return new ApiError(0, 'Cannot reach Supabase. Check your internet connection and the VITE_SUPABASE_URL in web/.env.');
  }
  return new ApiError(error.status ?? 400, error.message);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // undefined = Supabase hasn't told us yet whether there is a saved session; null = signed out.
  const [sessionUid, setSessionUid] = useState<string | null | undefined>(undefined);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  // One /auth/me at a time per user, shared between login() and the session listener below.
  const inflight = useRef<{ uid: string; promise: Promise<User> } | null>(null);
  const loadProfile = useCallback((uid: string): Promise<User> => {
    if (inflight.current?.uid === uid) return inflight.current.promise;
    const promise = api.get<{ user: User }>('/auth/me').then((r) => r.user).finally(() => {
      if (inflight.current?.promise === promise) inflight.current = null;
    });
    inflight.current = { uid, promise };
    return promise;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    qc.clear();
    void supabase.auth.signOut();
  }, [qc]);

  // Supabase restores the saved session (INITIAL_SESSION), refreshes tokens, and reports sign-in/out from any tab.
  // Keep this callback synchronous: calling Supabase from inside it can deadlock.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSessionUid(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  // Whenever the signed-in account changes, load its profile (name, role…) from the API.
  useEffect(() => {
    if (sessionUid === undefined) return;
    if (sessionUid === null) {
      setUser(null);
      qc.clear();
      setLoading(false);
      return;
    }
    if (userRef.current?.id === sessionUid) {
      setLoading(false);
      return;
    }
    if (userRef.current) qc.clear(); // a different account signed in: drop the previous one's cached data
    let cancelled = false;
    loadProfile(sessionUid)
      .then((u) => { if (!cancelled) setUser(u); })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Only a rejected session ends it. If the API is merely unreachable, stay put and let the user retry.
        if (e instanceof ApiError && e.status === 401) void supabase.auth.signOut();
        setUser(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionUid, qc, loadProfile]);

  // Any API call that comes back 401 (expired/revoked session) signs the user out.
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, logout);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, logout);
  }, [logout]);

  // Live updates from the shared database.
  useRealtimeSync(!!user);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw toApiError(error);
    try {
      const u = await loadProfile(data.user.id);
      qc.clear();
      setUser(u);
      return u;
    } catch (e) {
      void supabase.auth.signOut(); // signed in to Supabase but the API refused/was unreachable: don't leave a half session
      throw e;
    }
  }, [qc, loadProfile]);

  const value = useMemo<AuthState>(
    () => ({
      user, loading, logout, login,
      register: async (input) => {
        // The API validates, creates the Supabase account (role is always "student"), then we sign in with it.
        await api.post('/auth/register', input);
        return login(input.email, input.password);
      },
    }),
    [user, loading, logout, login],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
