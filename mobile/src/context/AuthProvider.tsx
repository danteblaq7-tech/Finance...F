import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, initApi, onUnauthorized } from '@/lib/api';
import { useRealtimeSync } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';
import type { User } from '@/lib/types';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  studentId: string;
  university?: string;
  course?: string;
  yearOfStudy?: string;
}

interface AuthState {
  user: User | null;
  /** true until the saved session (if any) has been checked */
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

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
    return new ApiError(0, 'Cannot reach Supabase. Check your internet connection.');
  }
  return new ApiError(error.status ?? 400, error.message);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // undefined = Supabase hasn't told us yet whether there is a saved session; null = signed out.
  const [sessionUid, setSessionUid] = useState<string | null | undefined>(undefined);
  const [apiReady, setApiReady] = useState(false);
  // The profile fetched for one specific account (user: null = the API refused or was unreachable).
  const [loaded, setLoaded] = useState<{ uid: string; user: User | null } | null>(null);

  // The signed-in user is DERIVED: it only counts while it belongs to the account Supabase says is signed in.
  const user = sessionUid && loaded?.uid === sessionUid ? loaded.user : null;
  const loading = !apiReady || sessionUid === undefined || (sessionUid !== null && loaded?.uid !== sessionUid);

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

  const logout = useCallback(async () => {
    setLoaded(null);
    qc.clear();
    await supabase.auth.signOut();
  }, [qc]);

  // Load the saved server-address override (so the first API call goes to the right place).
  useEffect(() => {
    let cancelled = false;
    void initApi().finally(() => {
      if (!cancelled) setApiReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Supabase restores the saved session (INITIAL_SESSION), refreshes tokens, and reports sign-in/out.
  // Keep this callback synchronous: calling Supabase from inside it can deadlock.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) qc.clear(); // signed out (here or from elsewhere): drop cached data
      setSessionUid(session?.user.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  // Whenever a different account is signed in, load its profile (name, role…) from the API.
  useEffect(() => {
    if (!apiReady || !sessionUid || loaded?.uid === sessionUid) return;
    let cancelled = false;
    loadProfile(sessionUid)
      .then((u) => {
        if (cancelled) return;
        qc.clear(); // never show a previous account's cached data
        setLoaded({ uid: sessionUid, user: u });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Only a rejected session ends it. If the API is merely unreachable, stay signed in to Supabase so the
        // next launch (once the backend is up) restores everything.
        if (e instanceof ApiError && e.status === 401) void supabase.auth.signOut();
        setLoaded({ uid: sessionUid, user: null });
      });
    return () => {
      cancelled = true;
    };
  }, [apiReady, sessionUid, loaded?.uid, qc, loadProfile]);

  // Any API call that comes back 401 (expired/revoked session) signs the user out.
  useEffect(() => {
    onUnauthorized(() => void logout());
    return () => onUnauthorized(null);
  }, [logout]);

  // Live updates from the shared database.
  useRealtimeSync(!!user);

  const login = useCallback(
    async (email: string, password: string): Promise<User> => {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw toApiError(error);
      try {
        const u = await loadProfile(data.user.id);
        qc.clear();
        setLoaded({ uid: data.user.id, user: u });
        return u;
      } catch (e) {
        void supabase.auth.signOut(); // signed in to Supabase but the API refused/was unreachable: no half-session
        throw e;
      }
    },
    [qc, loadProfile],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      logout,
      login,
      register: async (input) => {
        // The API validates and creates the Supabase account (role is always "student"); then we sign in with it.
        await api.post('/auth/register', input);
        return login(input.email, input.password);
      },
    }),
    [user, loading, logout, login],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
