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
  refreshProfile: () => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);
type AuthIdentity = {
  id: string;
  email?: string;
  user_metadata?: { name?: string };
  app_metadata?: { role?: string; must_change_password?: boolean };
};

const isUserRole = (role: unknown): role is User['role'] =>
  role === 'student' || role === 'staff' || role === 'admin' || role === 'lecturer';

function pendingPasswordUser(identity: AuthIdentity): User {
  return {
    id: identity.id,
    name: identity.user_metadata?.name || identity.email?.split('@')[0] || 'Account holder',
    email: identity.email || '',
    student_id: null,
    university: null,
    course: null,
    year_of_study: null,
    role: isUserRole(identity.app_metadata?.role) ? identity.app_metadata.role : 'student',
    must_change_password: true,
  };
}

const isPasswordChangeRequired = (error: unknown) =>
  error instanceof ApiError
  && error.status === 403
  && error.message === 'Change your temporary password before continuing.';

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
  const [authIdentity, setAuthIdentity] = useState<AuthIdentity | null>(null);
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

  const refreshProfile = useCallback(async () => {
    if (!userRef.current) throw new Error('You must be signed in to refresh your profile.');
    const updated = await loadProfile(userRef.current.id);
    setUser(updated);
    return updated;
  }, [loadProfile]);

  const logout = useCallback(() => {
    setUser(null);
    qc.clear();
    void supabase.auth.signOut();
  }, [qc]);

  // Supabase restores the saved session (INITIAL_SESSION), refreshes tokens, and reports sign-in/out from any tab.
  // Keep this callback synchronous: calling Supabase from inside it can deadlock.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthIdentity(session?.user ? session.user as AuthIdentity : null);
      setSessionUid(session?.user.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Whenever the signed-in account changes, load its profile (name, role…) from the API.
  useEffect(() => {
    if (sessionUid === undefined) return;
    if (sessionUid === null) {
      setUser(null);
      setAuthIdentity(null);
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
    if (authIdentity?.id === sessionUid && authIdentity.app_metadata?.must_change_password) {
      setUser(pendingPasswordUser(authIdentity));
      setLoading(false);
      return;
    }
    loadProfile(sessionUid)
      .then((u) => { if (!cancelled) setUser(u); })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isPasswordChangeRequired(e) && authIdentity?.id === sessionUid) {
          setUser(pendingPasswordUser(authIdentity));
          return;
        }
        // Only a rejected session ends it. If the API is merely unreachable, stay put and let the user retry.
        if (e instanceof ApiError && e.status === 401) void supabase.auth.signOut();
        setUser(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionUid, authIdentity, qc, loadProfile]);

  // Any API call that comes back 401 (expired/revoked session) signs the user out.
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, logout);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, logout);
  }, [logout]);

  // Live updates from the shared database.
  useRealtimeSync(
    !!user
    && !user.must_change_password
    && (!user.mfa?.required || (user.mfa.enrolled && user.mfa.assuranceLevel === 'aal2')),
  );

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw toApiError(error);
    const identity = data.user as AuthIdentity;
    setAuthIdentity(identity);
    try {
      if (identity.app_metadata?.must_change_password) {
        const pending = pendingPasswordUser(identity);
        qc.clear();
        setUser(pending);
        return pending;
      }
      const u = await loadProfile(data.user.id);
      qc.clear();
      setUser(u);
      return u;
    } catch (e) {
      if (isPasswordChangeRequired(e)) {
        const pending = pendingPasswordUser(identity);
        qc.clear();
        setUser(pending);
        return pending;
      }
      void supabase.auth.signOut(); // signed in to Supabase but the API refused/was unreachable: don't leave a half session
      throw e;
    }
  }, [qc, loadProfile]);

  const value = useMemo<AuthState>(
    () => ({
      user, loading, logout, login,
      refreshProfile,
      register: async (input) => {
        // The API validates, creates the Supabase account (role is always "student"), then we sign in with it.
        await api.post('/auth/register', input);
        return login(input.email, input.password);
      },
    }),
    [user, loading, logout, login, refreshProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
