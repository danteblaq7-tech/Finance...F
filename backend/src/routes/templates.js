import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';

const router = Router();
router.use(requireAuth, requireStaff);

router.get(
  '/templates',
  asyncHandler(async (_req, res) => {
    res.json({ templates: await query('SELECT template_key, subject, html, updated_at FROM email_templates ORDER BY template_key') });
  }),
);

router.put(
  '/templates/:key',
  asyncHandler(async (req, res) => {
    const key = z.enum(['exam_card', 'rejection']).parse(req.params.key);
    const b = z.object({ subject: z.string().trim().min(3).max(255), html: z.string().min(10).max(200_000) }).parse(req.body);
    const template = await queryOne(
      `UPDATE email_templates SET subject = $1, html = $2, updated_by = $3 WHERE template_key = $4
       RETURNING template_key, subject, html, updated_at`,
      [b.subject, b.html, req.user.id, key],
    );
    if (!template) throw new HttpError(404, 'Template not found.');
    res.json({ template });
  }),
);

router.get(
  '/emails',
  asyncHandler(async (_req, res) => {
    res.json({
      emails: await query(
        'SELECT id, email_type, to_email, to_name, semester, academic_year, card_number, delivered, sent_at FROM sent_emails ORDER BY sent_at DESC LIMIT 200',
      ),
    });
  }),
);

router.get(
  '/emails/:id',
  asyncHandler(async (req, res) => {
    const e = await queryOne('SELECT * FROM sent_emails WHERE id = $1', [req.params.id]);
    if (!e) throw new HttpError(404, 'Email not found.');
    res.json({ email: e });
  }),
);

export default router;
