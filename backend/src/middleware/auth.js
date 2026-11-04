import { queryOne } from '../db.js';
import { supabaseAdmin } from '../supabase.js';
import { HttpError } from './errors.js';

export const PUBLIC_USER_COLUMNS =
  'id, name, email, student_id, university, course, year_of_study, role, avatar_url, created_at';

// Asking Supabase Auth to validate a token costs a network round trip. A page load fires several API calls
// at once with the same token, so remember "this token belongs to user X" for a few seconds.
// (The profile row is still loaded fresh every time, so role changes take effect immediately.)
const TOKEN_CACHE_MS = 15_000;
const tokenCache = new Map(); // token -> { id, until }

async function userIdFromToken(token) {
  const hit = tokenCache.get(token);
  if (hit && hit.until > Date.now()) return hit.id;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    // 4xx = the token itself is bad/expired. Anything else = we couldn't ask Supabase; don't sign people out for that.
    const status = error?.status;
    const tokenProblem = !error || (typeof status === 'number' && status >= 400 && status < 500);
    if (tokenProblem) throw new HttpError(401, 'Session expired. Please sign in again.');
    throw new HttpError(503, 'Could not reach the sign-in service. Please try again in a moment.');
  }

  if (tokenCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of tokenCache) if (v.until <= now) tokenCache.delete(k);
    if (tokenCache.size > 500) tokenCache.clear();
  }
  tokenCache.set(token, { id: data.user.id, until: Date.now() + TOKEN_CACHE_MS });
  return data.user.id;
}

/** Verifies the Supabase access token (sent as "Authorization: Bearer …"), then loads the CURRENT profile row. */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) throw new HttpError(401, 'Not signed in.');
    const id = await userIdFromToken(token);
    const user = await queryOne(`SELECT ${PUBLIC_USER_COLUMNS} FROM profiles WHERE id = $1`, [id]);
    if (!user) throw new HttpError(401, 'Account no longer exists.');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

export const isStaff = (user) => ['staff', 'admin'].includes(user.role);

export const requireStaff = (req, _res, next) =>
  req.user && isStaff(req.user) ? next() : next(new HttpError(403, 'Staff access only.'));

export const requireStudent = (req, _res, next) =>
  req.user?.role === 'student' ? next() : next(new HttpError(403, 'Students only.'));
