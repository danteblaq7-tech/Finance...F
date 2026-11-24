import { queryOne } from '../db.js';
import { listVerifiedTotpFactors, markMfaEnrolled } from '../mfa.js';
import { supabaseAdmin } from '../supabase.js';
import { trackActivity } from './activity.js';
import { HttpError } from './errors.js';

export const PUBLIC_USER_COLUMNS =
  'id, name, email, student_id, university, course, year_of_study, role, avatar_url, created_at, must_change_password';

// Asking Supabase Auth to validate a token costs a network round trip. A page load fires several API calls
// at once with the same token, so remember "this token belongs to user X" for a few seconds.
// (The profile row is still loaded fresh every time, so role changes take effect immediately.)
const TOKEN_CACHE_MS = 15_000;
const tokenCache = new Map(); // token -> { id, aal, until }

async function userIdFromToken(token) {
  const hit = tokenCache.get(token);
  if (hit && hit.until > Date.now()) return hit;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    // 4xx = the token itself is bad/expired. Anything else = we couldn't ask Supabase; don't sign people out for that.
    const status = error?.status;
    const tokenProblem = !error || (typeof status === 'number' && status >= 400 && status < 500);
    if (tokenProblem) throw new HttpError(401, 'Session expired. Please sign in again.');
    throw new HttpError(503, 'Could not reach the sign-in service. Please try again in a moment.');
  }

  const { data: claimsData, error: claimsError } = await supabaseAdmin.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.aal) {
    const status = claimsError?.status;
    const tokenProblem = !claimsError || (typeof status === 'number' && status >= 400 && status < 500);
    if (tokenProblem) throw new HttpError(401, 'Session expired. Please sign in again.');
    throw new HttpError(503, 'Could not verify the sign-in assurance level. Please try again in a moment.');
  }

  if (tokenCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of tokenCache) if (v.until <= now) tokenCache.delete(k);
    if (tokenCache.size > 500) tokenCache.clear();
  }
  const verified = { id: data.user.id, aal: claimsData.claims.aal, until: Date.now() + TOKEN_CACHE_MS };
  tokenCache.set(token, verified);
  return verified;
}

/** Verifies the Supabase access token (sent as "Authorization: Bearer …"), then loads the CURRENT profile row. */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) throw new HttpError(401, 'Not signed in.');
    const { id, aal } = await userIdFromToken(token);
    const user = await queryOne(
      `SELECT ${PUBLIC_USER_COLUMNS}, is_active,
              EXISTS (SELECT 1 FROM public.staff_mfa_enrollments e WHERE e.user_id = profiles.id AND e.enrollment_status = 'verified') AS mfa_enrolled,
              EXISTS (SELECT 1 FROM public.staff_mfa_enrollments e WHERE e.user_id = profiles.id AND e.enrollment_status = 'pending') AS mfa_pending,
              COALESCE((SELECT s.require_staff_mfa FROM public.auth_security_settings s WHERE s.singleton), false) AS mfa_required_by_policy
       FROM profiles WHERE id = $1`,
      [id],
    );
    if (!user) throw new HttpError(401, 'Account no longer exists.');
    if (!user.is_active) throw new HttpError(401, 'This account has been deactivated.');
    if (
      user.must_change_password
      && !(req.baseUrl === '/api/auth' && req.method === 'POST' && req.path === '/change-password')
    ) {
      throw new HttpError(403, 'Change your temporary password before continuing.');
    }
    const staffAccount = ['staff', 'admin'].includes(user.role);
    const mfaSetupRoute = req.baseUrl === '/api/auth'
      && ((req.method === 'GET' && (req.path === '/me' || req.path === '/mfa/status'))
        || (req.method === 'POST' && ['/mfa/begin-enrollment', '/mfa/complete-enrollment'].includes(req.path)));
    if (staffAccount && !user.mfa_enrolled && !user.mfa_pending && mfaSetupRoute) {
      const verifiedFactors = await listVerifiedTotpFactors(id);
      if (verifiedFactors.length) user.mfa_enrolled = true;
      if (verifiedFactors.length) await markMfaEnrolled(id);
    }
    const mfaRequired = staffAccount && (user.mfa_enrolled || user.mfa_pending || user.mfa_required_by_policy);
    if (mfaRequired && (!user.mfa_enrolled || aal !== 'aal2') && !mfaSetupRoute) {
      throw new HttpError(403, 'Complete two-factor authentication before continuing.');
    }
    const mfaEnrolled = Boolean(user.mfa_enrolled);
    const mfaPending = Boolean(user.mfa_pending);
    delete user.is_active;
    delete user.mfa_enrolled;
    delete user.mfa_pending;
    delete user.mfa_required_by_policy;
    user.mfa = {
      enrolled: mfaEnrolled,
      pending: mfaPending,
      required: Boolean(mfaRequired),
      assuranceLevel: aal,
    };
    req.user = user;
    trackActivity(user.id);
    next();
  } catch (e) {
    next(e);
  }
}

export const isStaff = (user) => ['staff', 'admin'].includes(user.role);

export const requireStaff = (req, _res, next) =>
  req.user && isStaff(req.user) ? next() : next(new HttpError(403, 'Staff access only.'));

// Lecturers (and finance staff/admins) may scan exam cards and sign units. Lecturers get NOTHING else: every other
// staff route keeps using requireStaff, which a lecturer does not pass.
export const isInvigilator = (user) => ['lecturer', 'staff', 'admin'].includes(user.role);

export const requireInvigilator = (req, _res, next) =>
  req.user && isInvigilator(req.user) ? next() : next(new HttpError(403, 'Invigilators only.'));

export const requireAdmin = (req, _res, next) =>
  req.user?.role === 'admin' ? next() : next(new HttpError(403, 'Admins only.'));

export const requireStudent = (req, _res, next) =>
  req.user?.role === 'student' ? next() : next(new HttpError(403, 'Students only.'));
