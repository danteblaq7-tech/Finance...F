import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

const isPlaceholder = (v: string) => /your[-_ ]?(project|anon)|paste[-_ ]/i.test(v);

/** False until web/.env has real values. main.tsx shows a setup screen instead of a broken app. */
export const supabaseConfigured = !!url && !!anonKey && !isPlaceholder(url) && !isPlaceholder(anonKey);

// The anon/publishable key is meant to be public: what it can do is limited by the database's Row Level Security.
// (Never put the service_role / secret key in the web app.)
export const supabase = createClient(
  supabaseConfigured ? url! : 'http://localhost:54321',
  supabaseConfigured ? anonKey! : 'not-configured',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
);
