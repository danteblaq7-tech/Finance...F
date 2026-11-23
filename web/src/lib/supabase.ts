import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

const placeholder = (v: string | undefined) =>
  !v || /your[-_ ]?(project|anon)|paste[-_ ]|\[YOUR/i.test(v);

if (placeholder(url)) {
  throw new Error('VITE_SUPABASE_URL is required at build time. Set it to the Supabase project URL.');
}
if (placeholder(anonKey)) {
  throw new Error('VITE_SUPABASE_ANON_KEY is required at build time. Set it to the Supabase anon/publishable key.');
}

try {
  const parsed = new URL(url!);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
} catch {
  throw new Error('VITE_SUPABASE_URL must be a valid HTTP(S) URL.');
}

// The anon/publishable key is public. Never put the service_role/secret key in the web app.
export const supabaseConfigured = true;
export const supabase = createClient(url!, anonKey!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
