import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errors.js';

// Dashboard numbers. Everything here is computed from real rows: nothing is estimated or stored twice.
//
//   active student   = a student who used the app that day (daily_activity: written by the API on every signed-in request)
//   ticket attended  = a staff member picked it up (it has an assignee) or it was resolved: see trg_ticket_lifecycle in schema.sql
//   ticket pending   = raised, not cancelled/resolved yet, and not yet attended
//   "today" / "per day" use the university's calendar (Africa/Nairobi), not the server's UTC clock
const router = Router();
router.use(requireAuth, requireStaff);

// The dashboard refetches often and many staff may have it open: share one result for a few seconds.
const cache = new Map();
const TTL_MS = 10_000;
async function cached(key, compute) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await compute();
  cache.set(key, { value, until: Date.now() + TTL_MS });
  if (cache.size > 50) cache.clear();
  return value;
}

const OVERVIEW_PEOPLE = `
  SELECT
    (SELECT count(*) FROM profiles WHERE role = 'student')                                                             AS students_total,
    (SELECT count(*) FROM profiles WHERE role = 'student' AND app_day(created_at) = app_today())                       AS new_students_today,
    (SELECT count(*) FROM daily_activity a JOIN profiles p ON p.id = a.user_id
      WHERE p.role = 'student' AND a.day = app_today())                                                                AS active_today,
    (SELECT count(DISTINCT a.user_id) FROM daily_activity a JOIN profiles p ON p.id = a.user_id
      WHERE p.role = 'student' AND a.day >= app_today() - 6)                                                           AS active_7d,
    (SELECT count(DISTINCT a.user_id) FROM daily_activity a JOIN profiles p ON p.id = a.user_id
      WHERE p.role = 'student' AND a.day >= app_today() - 29)                                                          AS active_30d,
    (SELECT count(*) FROM daily_activity a JOIN profiles p ON p.id = a.user_id
      WHERE p.role = 'student' AND a.day = app_today() AND a.last_seen_at > now() - interval '5 minutes')              AS online_now`;

const OVERVIEW_TICKETS = `
  SELECT
    count(*)                                                                                        AS total,
    count(*) FILTER (WHERE status = 'pending')                                                      AS pending,
    count(*) FILTER (WHERE status = 'in_review')                                                    AS in_review,
    count(*) FILTER (WHERE status = 'resolved')                                                     AS resolved,
    count(*) FILTER (WHERE status = 'cancelled')                                                    AS cancelled,
    count(*) FILTER (WHERE status IN ('pending','in_review') AND attended_at IS NULL)               AS awaiting_attention,
    count(*) FILTER (WHERE app_day(created_at) = app_today())                                       AS raised_today,
    count(*) FILTER (WHERE attended_at IS NOT NULL AND app_day(attended_at) = app_today())          AS attended_today,
    count(*) FILTER (WHERE resolved_at IS NOT NULL AND app_day(resolved_at) = app_today())          AS resolved_today,
    round((extract(epoch FROM avg(attended_at - created_at)
           FILTER (WHERE attended_at IS NOT NULL AND created_at >= now() - interval '30 days')) / 3600)::numeric, 1) AS avg_first_response_hours,
    round((extract(epoch FROM now() - min(created_at) FILTER (WHERE status IN ('pending','in_review') AND attended_at IS NULL)) / 3600)::numeric, 1) AS oldest_waiting_hours
  FROM tickets`;

// Exam figures cover the exam periods that are currently active.
const OVERVIEW_EXAMS = `
  SELECT
    count(*)                                                                         AS total,
    count(*) FILTER (WHERE a.status = 'pending')                                     AS pending,
    count(*) FILTER (WHERE a.status = 'pending' AND a.decision_source = 'statement') AS awaiting_verification,
    count(*) FILTER (WHERE a.status = 'approved')                                    AS approved,
    count(*) FILTER (WHERE a.status = 'rejected')                                    AS rejected,
    count(*) FILTER (WHERE a.status = 'issued' AND a.revoked_at IS NULL)             AS issued,
    count(*) FILTER (WHERE a.revoked_at IS NOT NULL)                                 AS revoked,
    count(*) FILTER (WHERE app_day(a.created_at) = app_today())                      AS applied_today,
    count(*) FILTER (WHERE a.card_issued_at IS NOT NULL AND app_day(a.card_issued_at) = app_today()) AS issued_today
  FROM exam_card_applications a JOIN exam_periods p ON p.id = a.exam_period_id
  WHERE p.is_active`;

const OVERVIEW_FEES = `
  SELECT
    count(*)                                          AS students,
    count(*) FILTER (WHERE f.is_cleared_for_exam)     AS cleared,
    count(*) FILTER (WHERE NOT f.is_cleared_for_exam) AS not_cleared,
    coalesce(sum(f.total_fee), 0)                     AS billed,
    coalesce(sum(f.amount_paid), 0)                   AS collected,
    coalesce(sum(f.balance), 0)                       AS outstanding
  FROM fee_records f
  WHERE EXISTS (SELECT 1 FROM exam_periods p WHERE p.is_active AND p.academic_year = f.academic_year AND p.semester = f.semester)`;

const OVERVIEW_STATEMENTS = `
  SELECT count(*) AS total,
         count(*) FILTER (WHERE app_day(created_at) = app_today()) AS uploaded_today,
         count(*) FILTER (WHERE outcome = 'needs_review')          AS needs_review
  FROM fee_statements`;

router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const data = await cached('overview', async () => {
      const [people, tickets, exams, fees, statements] = await Promise.all([
        queryOne(OVERVIEW_PEOPLE), queryOne(OVERVIEW_TICKETS), queryOne(OVERVIEW_EXAMS), queryOne(OVERVIEW_FEES), queryOne(OVERVIEW_STATEMENTS),
      ]);
      const collectionRate = fees.billed > 0 ? Math.round((fees.collected / fees.billed) * 1000) / 10 : null;
      return { generatedAt: new Date().toISOString(), people, tickets, exams, fees: { ...fees, collectionRate }, statements };
    });
    res.json(data);
  }),
);

// One row per calendar day for the last N days (zero-filled, oldest first).
const DAILY = `
  WITH days AS (
    SELECT d::date AS day FROM generate_series(app_today() - ($1::int - 1), app_today(), interval '1 day') AS d
  ),
  active AS (
    SELECT a.day, count(*) AS n FROM daily_activity a JOIN profiles p ON p.id = a.user_id
     WHERE p.role = 'student' AND a.day >= app_today() - ($1::int - 1) GROUP BY a.day
  ),
  raised   AS (SELECT app_day(created_at)   AS day, count(*) AS n FROM tickets WHERE app_day(created_at)   >= app_today() - ($1::int - 1) GROUP BY 1),
  attended AS (SELECT app_day(attended_at)  AS day, count(*) AS n FROM tickets WHERE attended_at IS NOT NULL AND app_day(attended_at) >= app_today() - ($1::int - 1) GROUP BY 1),
  resolved AS (SELECT app_day(resolved_at)  AS day, count(*) AS n FROM tickets WHERE resolved_at IS NOT NULL AND app_day(resolved_at) >= app_today() - ($1::int - 1) GROUP BY 1),
  applied  AS (SELECT app_day(created_at)   AS day, count(*) AS n FROM exam_card_applications WHERE app_day(created_at) >= app_today() - ($1::int - 1) GROUP BY 1),
  issued   AS (SELECT app_day(card_issued_at) AS day, count(*) AS n FROM exam_card_applications WHERE card_issued_at IS NOT NULL AND app_day(card_issued_at) >= app_today() - ($1::int - 1) GROUP BY 1),
  uploads  AS (SELECT app_day(created_at)   AS day, count(*) AS n FROM fee_statements WHERE app_day(created_at) >= app_today() - ($1::int - 1) GROUP BY 1)
  SELECT to_char(d.day, 'YYYY-MM-DD')                AS day,
         coalesce(active.n, 0)                       AS active_students,
         coalesce(raised.n, 0)                       AS tickets_raised,
         coalesce(attended.n, 0)                     AS tickets_attended,
         coalesce(resolved.n, 0)                     AS tickets_resolved,
         -- tickets that were open and still unattended when that day ended
         (SELECT count(*) FROM tickets t
           WHERE app_day(t.created_at) <= d.day
             AND (t.attended_at IS NULL OR app_day(t.attended_at) > d.day)
             AND (t.closed_at   IS NULL OR app_day(t.closed_at)   > d.day)) AS tickets_pending,
         coalesce(applied.n, 0)                      AS applications,
         coalesce(issued.n, 0)                       AS cards_issued,
         coalesce(uploads.n, 0)                      AS statements_uploaded
    FROM days d
    LEFT JOIN active   ON active.day   = d.day
    LEFT JOIN raised   ON raised.day   = d.day
    LEFT JOIN attended ON attended.day = d.day
    LEFT JOIN resolved ON resolved.day = d.day
    LEFT JOIN applied  ON applied.day  = d.day
    LEFT JOIN issued   ON issued.day   = d.day
    LEFT JOIN uploads  ON uploads.day  = d.day
   ORDER BY d.day`;

router.get(
  '/daily',
  asyncHandler(async (req, res) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }).parse(req.query);
    const rows = await cached(`daily:${days}`, () => query(DAILY, [days]));
    res.json({ days: rows });
  }),
);

export default router;
