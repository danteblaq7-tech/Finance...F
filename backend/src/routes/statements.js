import { createHash } from 'node:crypto';
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { decideFromStatement } from '../clearance.js';
import { config } from '../config.js';
import { bind, query, queryOne, withTransaction } from '../db.js';
import { safeFileName, sniffFile } from '../fileType.js';
import { isStaff, requireAuth, requireStaff, requireStudent } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { extractPdfText } from '../pdfText.js';
import { APP_SELECT, canReplace, loadOpenPeriod, sendRejectionEmail } from '../services/applications.js';
import { checkOwnership, parseFeeStatement } from '../statementParser.js';
import { saveStatementFile, statementSignedUrl } from '../storage.js';

const router = Router();
router.use(requireAuth);

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.nodeEnv === 'test' ? 1000 : 10,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads. Please try again later.' },
});

const STATEMENT_SELECT = `SELECT s.*, u.name AS student_name, u.email AS student_email
                            FROM fee_statements s JOIN profiles u ON u.id = s.student_uid`;

/**
 * POST /api/fee-statements?examPeriodId=<uuid>      (students)
 * The request body IS the file (PDF, CSV/TXT or a photo); the browser sends it with its own Content-Type and, optionally,
 * "X-File-Name". No multipart parsing needed. The server:
 *   1. checks what the file really is, 2. reads the text and the figures, 3. checks it is THIS student's statement for THIS period,
 *   4. stores the file privately, 5. decides the exam-card application from the figures (see clearance.js).
 */
router.post(
  '/',
  requireStudent,
  uploadLimiter,
  express.raw({ type: () => true, limit: config.maxStatementBytes }),
  asyncHandler(async (req, res) => {
    const { examPeriodId } = z.object({ examPeriodId: z.string().uuid() }).parse(req.query);
    const user = req.user;
    if (!user.student_id) throw new HttpError(400, 'Your profile has no student ID. Contact the finance office.');
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new HttpError(400, 'No file received. Choose your fee statement (PDF, CSV or a clear photo).');

    const file = sniffFile(buffer);
    if (!file) throw new HttpError(415, 'That file type is not supported. Upload a PDF, CSV or a clear photo (PNG/JPG) of your fee statement.');
    let fileName = 'statement';
    try { fileName = safeFileName(decodeURIComponent(req.get('x-file-name') || 'statement')); } catch { /* malformed header: keep default */ }

    const period = await loadOpenPeriod(examPeriodId);
    const existing = await queryOne('SELECT id, status, decision_source FROM exam_card_applications WHERE student_uid = $1 AND exam_period_id = $2', [user.id, period.id]);
    if (existing && !canReplace(existing)) throw new HttpError(409, 'You have already applied for this exam period.');

    // 1-3. Read it.
    let text = '';
    let unreadable = false;
    if (file.kind === 'pdf') {
      try { text = await extractPdfText(buffer); } catch (e) { console.warn('PDF text extraction failed:', e.message); unreadable = true; }
    } else if (file.kind === 'text') {
      text = buffer.toString('utf8');
    } else {
      unreadable = true; // a photo: no text layer, a person has to read it
    }
    if (!text.trim()) unreadable = true;

    const parsed = unreadable ? parseFeeStatement('') : parseFeeStatement(text);
    const ownership = unreadable
      ? { identity: 'unknown', flags: ['no_student_id'] }
      : checkOwnership(parsed, text, { studentId: user.student_id, academicYear: period.academic_year });
    if (ownership.identity === 'mismatch') {
      throw new HttpError(422, `This statement is for a different student (${parsed.studentId}). Please upload your own fee statement.`);
    }
    const flags = [...new Set([...parsed.flags, ...ownership.flags, ...(unreadable ? ['unreadable'] : [])])];

    // An official fee record, imported by the finance office, always wins over an uploaded document.
    const official = await queryOne(
      'SELECT id, amount_paid FROM fee_records WHERE student_id = $1 AND academic_year = $2 AND semester = $3',
      [user.student_id, period.academic_year, period.semester],
    );
    if (official && parsed.amountPaid !== null && Math.abs(official.amount_paid - parsed.amountPaid) > 1) flags.push('differs_from_official_record');

    let decision = null;
    if (!official) {
      decision = decideFromStatement({ parsed, flags, minPercent: period.min_payment_percent, mode: config.feeStatementMode, identity: ownership.identity });
    }

    // 4. Keep the original file, privately.
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const filePath = `${user.id}/${period.id}/${Date.now()}-${sha256.slice(0, 12)}.${file.ext}`;
    try {
      await saveStatementFile(filePath, buffer, file.mime);
    } catch (e) {
      console.error('Saving the statement failed:', e.message);
      throw new HttpError(502, 'Could not store your statement right now. Please try again.');
    }

    // 5. Record the statement and the application together.
    const statementId = crypto.randomUUID();
    const appId = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO fee_statements
           (id, student_uid, student_id, exam_period_id, academic_year, semester, file_path, file_name, mime_type, size_bytes, sha256,
            total_fee, amount_paid, balance, confidence, parse_source, flags, identity, outcome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [statementId, user.id, user.student_id, period.id, period.academic_year, period.semester, filePath, fileName, file.mime, buffer.length, sha256,
          parsed.totalFee, parsed.amountPaid, parsed.balance, parsed.confidence, parsed.source, flags, ownership.identity,
          official ? 'official_record' : decision.outcome],
      );
      if (existing) await client.query('DELETE FROM exam_card_applications WHERE id = $1', [existing.id]);
      if (official) {
        // Status 'pending' + decision_source 'fee_record' → the database trigger decides from the official record.
        await client.query(
          `INSERT INTO exam_card_applications
             (id, student_uid, student_id, student_name, email, course, year_of_study, exam_period_id, academic_year, semester, status, statement_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11)`,
          [appId, user.id, user.student_id, user.name, user.email, user.course, user.year_of_study, period.id, period.academic_year, period.semester, statementId],
        );
      } else {
        await client.query(
          `INSERT INTO exam_card_applications
             (id, student_uid, student_id, student_name, email, course, year_of_study, exam_period_id, academic_year, semester,
              status, rejection_reason, status_note, total_fee, amount_paid, balance, decision_source, statement_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'statement',$17)`,
          [appId, user.id, user.student_id, user.name, user.email, user.course, user.year_of_study, period.id, period.academic_year, period.semester,
            decision.status, decision.reason, decision.note, parsed.totalFee ?? 0, parsed.amountPaid ?? 0, parsed.balance ?? 0, statementId],
        );
      }
    });

    const application = await queryOne(`${APP_SELECT} WHERE a.id = $1`, [appId]);
    if (application.status === 'rejected') await sendRejectionEmail(application, user.id).catch((e) => console.error('Rejection email failed:', e.message));
    const statement = await queryOne(`${STATEMENT_SELECT} WHERE s.id = $1`, [statementId]);
    res.status(201).json({ statement, application, usedOfficialRecord: Boolean(official) });
  }),
);

// The signed-in student's own uploads.
router.get(
  '/mine',
  requireStudent,
  asyncHandler(async (req, res) => {
    const rows = await query(`${STATEMENT_SELECT} WHERE s.student_uid = $1 ORDER BY s.created_at DESC LIMIT 50`, [req.user.id]);
    res.json({ statements: rows });
  }),
);

// Staff: everything students uploaded, newest first.
router.get(
  '/',
  requireStaff,
  asyncHandler(async (req, res) => {
    const { outcome, search } = z
      .object({ outcome: z.enum(['cleared', 'not_cleared', 'needs_review', 'official_record']).optional(), search: z.string().max(100).optional() })
      .parse(req.query);
    const where = [];
    const params = [];
    if (outcome) where.push(`s.outcome = ${bind(params, outcome)}`);
    if (search) {
      const like = bind(params, `%${search}%`);
      where.push(`(s.student_id ILIKE ${like} OR u.name ILIKE ${like})`);
    }
    const rows = await query(`${STATEMENT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.created_at DESC LIMIT 200`, params);
    res.json({ statements: rows });
  }),
);

// A link to the original file, valid for 5 minutes. Owner or staff only.
router.get(
  '/:id/file',
  asyncHandler(async (req, res) => {
    const s = await queryOne('SELECT student_uid, file_path, file_name FROM fee_statements WHERE id = $1', [req.params.id]);
    if (!s || (!isStaff(req.user) && s.student_uid !== req.user.id)) throw new HttpError(404, 'Statement not found.');
    try {
      res.json({ url: await statementSignedUrl(s.file_path, 300), fileName: s.file_name, expiresInSeconds: 300 });
    } catch (e) {
      console.error('Signing the statement link failed:', e.message);
      throw new HttpError(502, 'Could not open the file right now. Please try again.');
    }
  }),
);

export default router;
