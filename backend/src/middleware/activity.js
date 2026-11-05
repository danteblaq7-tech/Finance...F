import { query } from '../db.js';

// "Active students" on the dashboard = students who used the app that day. Every authenticated request calls
// trackActivity(), but we write at most once a minute per user so this costs almost nothing.
const lastWrite = new Map(); // userId -> ms
const EVERY_MS = 60_000;

export function trackActivity(userId) {
  const now = Date.now();
  if ((lastWrite.get(userId) ?? 0) > now - EVERY_MS) return;
  lastWrite.set(userId, now);
  if (lastWrite.size > 5000) for (const [k, v] of lastWrite) if (v < now - EVERY_MS) lastWrite.delete(k);
  // Fire and forget: tracking must never slow down or fail a real request.
  query(
    `INSERT INTO daily_activity (day, user_id) VALUES (app_today(), $1)
     ON CONFLICT (day, user_id) DO UPDATE SET last_seen_at = now(), pings = daily_activity.pings + 1`,
    [userId],
  ).catch((e) => {
    lastWrite.delete(userId);
    console.error('Activity tracking failed:', e.message);
  });
}
