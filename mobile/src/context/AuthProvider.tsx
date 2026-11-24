import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, onUnauthorized } from '@/lib/api';
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
  refreshProfile: () => Promise<User>;
  logout: () => Promise<void>;
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
  const [authIdentity, setAuthIdentity] = useState<AuthIdentity | null>(null);
  // The profile fetched for one specific account (user: null = the API refused or was unreachable).
  const [loaded, setLoaded] = useState<{ uid: string; user: User | null } | null>(null);

  // The signed-in user is DERIVED: it only counts while it belongs to the account Supabase says is signed in.
  const user = sessionUid && loaded?.uid === sessionUid ? loaded.user : null;
  const loading = sessionUid === undefined || (sessionUid !== null && loaded?.uid !== sessionUid);

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
    if (!sessionUid) throw new Error('You must be signed in to refresh your profile.');
    const updated = await loadProfile(sessionUid);
    setLoaded({ uid: sessionUid, user: updated });
    return updated;
  }, [loadProfile, sessionUid]);

  const logout = useCallback(async () => {
    setLoaded(null);
    qc.clear();
    await supabase.auth.signOut();
  }, [qc]);

  // Supabase restores the saved session (INITIAL_SESSION), refreshes tokens, and reports sign-in/out.
  // Keep this callback synchronous: calling Supabase from inside it can deadlock.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) qc.clear(); // signed out (here or from elsewhere): drop cached data
      setAuthIdentity(session?.user ? session.user as AuthIdentity : null);
      setSessionUid(session?.user.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  // Whenever a different account is signed in, load its profile (name, role…) from the API.
  useEffect(() => {
    if (!sessionUid || loaded?.uid === sessionUid) return;
    if (authIdentity?.id === sessionUid && authIdentity.app_metadata?.must_change_password) {
      setLoaded({ uid: sessionUid, user: pendingPasswordUser(authIdentity) });
      return;
    }
    let cancelled = false;
    loadProfile(sessionUid)
      .then((u) => {
        if (cancelled) return;
        qc.clear(); // never show a previous account's cached data
        setLoaded({ uid: sessionUid, user: u });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isPasswordChangeRequired(e) && authIdentity?.id === sessionUid) {
          setLoaded({ uid: sessionUid, user: pendingPasswordUser(authIdentity) });
          return;
        }
        // Only a rejected session ends it. If the API is merely unreachable, stay signed in to Supabase so the
        // next launch (once the backend is up) restores everything.
        if (e instanceof ApiError && e.status === 401) void supabase.auth.signOut();
        setLoaded({ uid: sessionUid, user: null });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionUid, authIdentity, loaded?.uid, qc, loadProfile]);

  // Any API call that comes back 401 (expired/revoked session) signs the user out.
  useEffect(() => {
    onUnauthorized(() => void logout());
    return () => onUnauthorized(null);
  }, [logout]);

  // Live updates from the shared database.
  useRealtimeSync(
    !!user
    && !user.must_change_password
    && (!user.mfa?.required || (user.mfa.enrolled && user.mfa.assuranceLevel === 'aal2')),
  );

  const login = useCallback(
    async (email: string, password: string): Promise<User> => {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw toApiError(error);
      const identity = data.user as AuthIdentity;
      setAuthIdentity(identity);
      try {
        if (identity.app_metadata?.must_change_password) {
          const pending = pendingPasswordUser(identity);
          qc.clear();
          setLoaded({ uid: data.user.id, user: pending });
          return pending;
        }
        const u = await loadProfile(data.user.id);
        qc.clear();
        setLoaded({ uid: data.user.id, user: u });
        return u;
      } catch (e) {
        if (isPasswordChangeRequired(e)) {
          const pending = pendingPasswordUser(identity);
          qc.clear();
          setLoaded({ uid: data.user.id, user: pending });
          return pending;
        }
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
      refreshProfile,
      register: async (input) => {
        // The API validates and creates the Supabase account (role is always "student"); then we sign in with it.
        await api.post('/auth/register', input);
        return login(input.email, input.password);
      },
    }),
    [user, loading, logout, login, refreshProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
