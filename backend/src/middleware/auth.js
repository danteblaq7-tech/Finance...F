import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { queryOne } from '../db.js';
import { HttpError } from './errors.js';

export const PUBLIC_USER_COLUMNS =
  'id, name, email, student_id, university, course, year_of_study, role, avatar_url, created_at';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/** Verifies the bearer token, then loads the CURRENT user row so role changes take effect immediately. */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Not signed in.');
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new HttpError(401, 'Session expired. Please sign in again.');
    }
    const user = await queryOne(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`, [payload.sub]);
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
