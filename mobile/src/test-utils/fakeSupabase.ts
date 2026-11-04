// Typed handle on the fake Supabase client that jest.setup.ts installs in place of '@/lib/supabase'.
export interface FakeSupabase {
  /** The saved session the app finds on start (null = signed out). */
  session: { access_token: string; user: { id: string } } | null;
  signIn: jest.Mock;
  signOut: jest.Mock;
}

export const fake = (jest.requireMock('@/lib/supabase') as { __fake: FakeSupabase }).__fake;
