import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

// These run on the server: never keep a session in memory or refresh tokens in the background.
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };

/** Full-power client (service-role key). Server only: creates users, checks tokens, resets passwords. */
export const supabaseAdmin = createClient(config.supabase.url, config.supabase.serviceRoleKey, options);

/** A throw-away client with the public key, e.g. to verify a password. Make a fresh one per use. */
export const createAnonClient = () => createClient(config.supabase.url, config.supabase.anonKey, options);
