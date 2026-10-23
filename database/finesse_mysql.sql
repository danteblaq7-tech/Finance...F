-- ============================================================================
--  FINESSE · Campus Finance Management System
--  MySQL schema + seed data   (MySQL 8.0+ / MariaDB 10.5+)
--
--  HOW TO IMPORT IN MYSQL WORKBENCH
--    Option A:  File > Open SQL Script... > pick this file > click the lightning
--               bolt (Execute). Runs everything, including the stored procedures.
--    Option B:  Server > Data Import > "Import from Self-Contained File" >
--               pick this file > Start Import.
--
--  WARNING: the first statements DROP and recreate the `finesse` database.
--           Any existing data in it is deleted.
--
--  DEMO LOGINS (all accounts share one password):  Finesse@2026
--    admin@finesse.ac.ke      admin
--    staff@finesse.ac.ke      staff
--    amina@students.finesse.ac.ke, brian@..., cynthia@..., david@...  students
--  Passwords are stored as bcrypt hashes in users.password_hash.
--  Change them before any real use.
-- ============================================================================

DROP DATABASE IF EXISTS finesse;
CREATE DATABASE finesse CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE finesse;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------------------------------------------------------
--  TABLES
-- ----------------------------------------------------------------------------

-- users: students, finance staff and admins (Firebase "users" collection)
CREATE TABLE users (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()),
  name            VARCHAR(150)  NOT NULL,
  email           VARCHAR(190)  NOT NULL,
  password_hash   VARCHAR(255)  NOT NULL,
  student_id      VARCHAR(40)   NULL COMMENT 'Institutional ID, e.g. EGM/027/2024',
  university      VARCHAR(150)  NULL,
  course          VARCHAR(150)  NULL,
  year_of_study   VARCHAR(10)   NULL,
  role            ENUM('student','staff','admin') NOT NULL DEFAULT 'student',
  avatar_url      VARCHAR(500)  NULL,
  expo_push_token VARCHAR(255)  NULL,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_student_id (student_id),
  KEY idx_users_role (role)
) ENGINE=InnoDB;

-- tickets: finance support requests
CREATE TABLE tickets (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  student_id          CHAR(36)     NOT NULL COMMENT 'FK -> users.id of the submitting student',
  student_name        VARCHAR(150) NOT NULL,
  issue_type          VARCHAR(40)  NOT NULL COMMENT 'fee_dispute, payment_plan, sponsorship, helb, bursary, fee_statement, other',
  description         TEXT         NOT NULL,
  attachment_url      VARCHAR(500) NULL,
  priority            ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  status              ENUM('pending','in_review','resolved','cancelled') NOT NULL DEFAULT 'pending',
  appointment_slot    DATETIME     NULL,
  appointment_slot_id CHAR(36)     NULL,
  staff_notes         TEXT         NOT NULL,
  assigned_staff_id   CHAR(36)     NULL,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tickets_student (student_id, created_at),
  KEY idx_tickets_status (status, created_at),
  CONSTRAINT fk_tickets_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tickets_staff   FOREIGN KEY (assigned_staff_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_tickets_desc   CHECK (CHAR_LENGTH(TRIM(description)) > 0)
) ENGINE=InnoDB;

-- slots: 30-minute appointment slots
CREATE TABLE slots (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  slot_date      DATE         NOT NULL,
  start_time     DATETIME     NOT NULL,
  end_time       DATETIME     NOT NULL,
  display_time   VARCHAR(12)  NULL COMMENT 'e.g. 09:00 AM',
  is_booked      TINYINT(1)   NOT NULL DEFAULT 0,
  booked_by      CHAR(36)     NULL,
  booked_by_name VARCHAR(150) NULL,
  ticket_id      CHAR(36)     NULL,
  booked_at      DATETIME     NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_slots_start (start_time),
  KEY idx_slots_date (slot_date, start_time),
  CONSTRAINT fk_slots_user   FOREIGN KEY (booked_by) REFERENCES users(id)   ON DELETE SET NULL,
  CONSTRAINT fk_slots_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- tickets.appointment_slot_id -> slots.id (added after both tables exist: circular reference)
ALTER TABLE tickets
  ADD CONSTRAINT fk_tickets_slot FOREIGN KEY (appointment_slot_id) REFERENCES slots(id) ON DELETE SET NULL;

-- fee_records: one row per student per semester (imported from the finance system)
CREATE TABLE fee_records (
  id                   CHAR(36)      NOT NULL DEFAULT (UUID()),
  student_id           VARCHAR(40)   NOT NULL COMMENT 'Institutional ID (users.student_id), not users.id',
  student_name         VARCHAR(150)  NULL,
  email                VARCHAR(190)  NULL,
  course               VARCHAR(150)  NULL,
  academic_year        VARCHAR(12)   NOT NULL COMMENT 'e.g. 2026/2027',
  semester             VARCHAR(20)   NOT NULL COMMENT 'e.g. Semester 1',
  total_fee            DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_paid          DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance              DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_cleared_for_exam  TINYINT(1)    NOT NULL DEFAULT 0,
  payment_ref          VARCHAR(80)   NULL,
  exception_granted_by CHAR(36)      NULL,
  exception_note       TEXT          NULL,
  created_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fee_student_term (student_id, academic_year, semester),
  CONSTRAINT fk_fee_exception_by FOREIGN KEY (exception_granted_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_fee_amounts CHECK (total_fee >= 0 AND amount_paid >= 0 AND balance >= 0)
) ENGINE=InnoDB;

-- exam_periods: windows in which students may apply for an exam card
CREATE TABLE exam_periods (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  title               VARCHAR(150) NOT NULL,
  academic_year       VARCHAR(12)  NOT NULL,
  semester            VARCHAR(20)  NOT NULL,
  exam_start_date     DATE         NOT NULL,
  exam_end_date       DATE         NOT NULL,
  application_open    DATE         NOT NULL,
  application_close   DATE         NOT NULL,
  min_payment_percent INT          NOT NULL DEFAULT 100,
  is_active           TINYINT(1)   NOT NULL DEFAULT 1,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_periods_active (is_active),
  CONSTRAINT chk_period_pct   CHECK (min_payment_percent BETWEEN 0 AND 100),
  CONSTRAINT chk_period_exam  CHECK (exam_end_date >= exam_start_date),
  CONSTRAINT chk_period_apply CHECK (application_close >= application_open)
) ENGINE=InnoDB;

-- exam_card_applications: one per student per exam period
CREATE TABLE exam_card_applications (
  id                   CHAR(36)      NOT NULL DEFAULT (UUID()),
  student_uid          CHAR(36)      NOT NULL COMMENT 'FK -> users.id',
  student_id           VARCHAR(40)   NOT NULL COMMENT 'Institutional ID',
  student_name         VARCHAR(150)  NOT NULL,
  email                VARCHAR(190)  NULL,
  course               VARCHAR(150)  NULL,
  year_of_study        VARCHAR(10)   NULL,
  exam_period_id       CHAR(36)      NOT NULL,
  academic_year        VARCHAR(12)   NOT NULL,
  semester             VARCHAR(20)   NOT NULL,
  status               ENUM('pending','approved','rejected','issued') NOT NULL DEFAULT 'pending',
  rejection_reason     TEXT          NULL,
  fee_record_id        CHAR(36)      NULL,
  amount_paid          DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_fee            DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance              DECIMAL(12,2) NOT NULL DEFAULT 0,
  manually_approved_by CHAR(36)      NULL,
  manual_approval_note TEXT          NULL,
  card_issued_at       DATETIME      NULL,
  email_sent_at        DATETIME      NULL,
  created_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_student_period (student_uid, exam_period_id),
  KEY idx_app_status (status, created_at),
  CONSTRAINT fk_app_user   FOREIGN KEY (student_uid)          REFERENCES users(id)        ON DELETE CASCADE,
  CONSTRAINT fk_app_period FOREIGN KEY (exam_period_id)       REFERENCES exam_periods(id) ON DELETE CASCADE,
  CONSTRAINT fk_app_fee    FOREIGN KEY (fee_record_id)        REFERENCES fee_records(id)  ON DELETE SET NULL,
  CONSTRAINT fk_app_staff  FOREIGN KEY (manually_approved_by) REFERENCES users(id)        ON DELETE SET NULL
) ENGINE=InnoDB;

-- email_templates: editable HTML for outgoing emails ({{placeholders}})
CREATE TABLE email_templates (
  template_key VARCHAR(30)  NOT NULL,
  subject      VARCHAR(255) NOT NULL,
  html         MEDIUMTEXT   NOT NULL,
  updated_by   CHAR(36)     NULL,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (template_key),
  CONSTRAINT fk_tpl_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_tpl_key CHECK (template_key IN ('exam_card','rejection'))
) ENGINE=InnoDB;

-- sent_emails: outbox of every exam-card / rejection email generated
CREATE TABLE sent_emails (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  email_type    ENUM('exam_card','rejection') NOT NULL,
  to_email      VARCHAR(190) NOT NULL,
  to_name       VARCHAR(150) NULL,
  semester      VARCHAR(20)  NULL,
  academic_year VARCHAR(12)  NULL,
  card_number   VARCHAR(30)  NULL,
  html          MEDIUMTEXT   NOT NULL,
  delivered     TINYINT(1)   NOT NULL DEFAULT 0,
  created_by    CHAR(36)     NULL,
  sent_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sent_at (sent_at),
  CONSTRAINT fk_sent_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- ----------------------------------------------------------------------------
--  TRIGGER: decide a new student application's outcome from the fee record.
--  The app inserts with status 'pending'; the database sets approved/rejected.
--  Rows inserted with an explicit non-pending status (e.g. seed data) are left alone.
-- ----------------------------------------------------------------------------
DELIMITER $$

CREATE TRIGGER trg_application_reconcile
BEFORE INSERT ON exam_card_applications
FOR EACH ROW
BEGIN
  DECLARE v_id      CHAR(36);
  DECLARE v_total   DECIMAL(12,2);
  DECLARE v_paid    DECIMAL(12,2);
  DECLARE v_bal     DECIMAL(12,2);
  DECLARE v_cleared TINYINT(1);

  IF NEW.status = 'pending' THEN
    SELECT id, total_fee, amount_paid, balance, is_cleared_for_exam
      INTO v_id, v_total, v_paid, v_bal, v_cleared
      FROM fee_records
     WHERE student_id = NEW.student_id
       AND academic_year = NEW.academic_year
       AND semester = NEW.semester
     LIMIT 1;

    IF v_id IS NULL THEN
      SET NEW.status = 'rejected',
          NEW.rejection_reason = 'No fee record found for this semester. Please visit the finance office with your payment receipts.',
          NEW.fee_record_id = NULL, NEW.total_fee = 0, NEW.amount_paid = 0, NEW.balance = 0;
    ELSE
      SET NEW.fee_record_id = v_id, NEW.total_fee = v_total,
          NEW.amount_paid = v_paid, NEW.balance = v_bal;
      IF v_cleared = 1 THEN
        SET NEW.status = 'approved', NEW.rejection_reason = NULL;
      ELSE
        SET NEW.status = 'rejected',
            NEW.rejection_reason = CONCAT('Your fees are not fully cleared. Outstanding balance: KSh ',
                                          FORMAT(v_bal, 0), '. Please settle your fees and reapply.');
      END IF;
    END IF;
  END IF;
END$$

-- ----------------------------------------------------------------------------
--  STORED PROCEDURES
-- ----------------------------------------------------------------------------

-- Generate 30-minute slots, 08:00-17:00, for one date. Skips dates already generated.
CREATE PROCEDURE generate_slots_for_date(IN p_date DATE)
BEGIN
  DECLARE v_cur DATETIME;
  DECLARE v_end DATETIME;
  IF NOT EXISTS (SELECT 1 FROM slots WHERE slot_date = p_date) THEN
    SET v_cur = TIMESTAMP(p_date, '08:00:00');
    SET v_end = TIMESTAMP(p_date, '17:00:00');
    WHILE v_cur < v_end DO
      INSERT INTO slots (slot_date, start_time, end_time, display_time)
      VALUES (p_date, v_cur, v_cur + INTERVAL 30 MINUTE, DATE_FORMAT(v_cur, '%h:%i %p'));
      SET v_cur = v_cur + INTERVAL 30 MINUTE;
    END WHILE;
  END IF;
END$$

-- Book a slot. The conditional UPDATE is the double-booking guard.
CREATE PROCEDURE book_slot(
  IN p_slot_id CHAR(36), IN p_user_id CHAR(36),
  IN p_user_name VARCHAR(150), IN p_ticket_id CHAR(36))
BEGIN
  DECLARE v_start DATETIME;
  START TRANSACTION;
  UPDATE slots
     SET is_booked = 1, booked_by = p_user_id, booked_by_name = p_user_name,
         ticket_id = p_ticket_id, booked_at = NOW()
   WHERE id = p_slot_id AND is_booked = 0;
  IF ROW_COUNT() = 0 THEN
    ROLLBACK;
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'This slot was just booked by someone else, or does not exist.';
  END IF;
  SELECT start_time INTO v_start FROM slots WHERE id = p_slot_id;
  UPDATE tickets
     SET appointment_slot = v_start, appointment_slot_id = p_slot_id,
         status = IF(status = 'pending', 'in_review', status)
   WHERE id = p_ticket_id;
  COMMIT;
END$$

-- Release a booked slot and clear it from its ticket.
CREATE PROCEDURE unbook_slot(IN p_slot_id CHAR(36))
BEGIN
  START TRANSACTION;
  UPDATE tickets SET appointment_slot = NULL, appointment_slot_id = NULL
   WHERE appointment_slot_id = p_slot_id;
  UPDATE slots
     SET is_booked = 0, booked_by = NULL, booked_by_name = NULL, ticket_id = NULL, booked_at = NULL
   WHERE id = p_slot_id;
  COMMIT;
END$$

DELIMITER ;

-- ----------------------------------------------------------------------------
--  VIEWS
-- ----------------------------------------------------------------------------

-- Staff dashboard queue: open tickets, highest priority and oldest first
CREATE VIEW v_staff_queue AS
SELECT t.id, t.student_name, u.student_id AS student_number, t.issue_type, t.priority,
       t.status, t.appointment_slot, t.created_at
  FROM tickets t
  JOIN users u ON u.id = t.student_id
 WHERE t.status IN ('pending','in_review')
 ORDER BY FIELD(t.priority,'high','medium','low'), t.created_at;

-- Exam-card applications with their period and clearance info
CREATE VIEW v_exam_applications AS
SELECT a.id, a.student_id, a.student_name, a.course, p.title AS exam_period,
       a.academic_year, a.semester, a.status, a.rejection_reason,
       a.total_fee, a.amount_paid, a.balance, a.card_issued_at, a.created_at
  FROM exam_card_applications a
  JOIN exam_periods p ON p.id = a.exam_period_id;

-- Per-semester clearance totals
CREATE VIEW v_fee_clearance_summary AS
SELECT academic_year, semester,
       COUNT(*)                         AS students,
       SUM(is_cleared_for_exam = 1)     AS cleared,
       SUM(is_cleared_for_exam = 0)     AS not_cleared,
       SUM(total_fee)                   AS total_billed,
       SUM(amount_paid)                 AS total_collected,
       SUM(balance)                     AS total_outstanding
  FROM fee_records
 GROUP BY academic_year, semester;

-- ----------------------------------------------------------------------------
--  SEED DATA
-- ----------------------------------------------------------------------------
-- All demo passwords below are bcrypt of:  Finesse@2026

INSERT INTO users (id, name, email, password_hash, student_id, university, course, year_of_study, role) VALUES
('a0000000-0000-4000-8000-000000000001','Grace Wanjiru','admin@finesse.ac.ke','$2b$10$4idmRi3kzZJwJSKDgT9l1eckF4V1S3ALaArKlSuvJP4HrqETgZhgm',NULL,'Moi University',NULL,NULL,'admin'),
('a0000000-0000-4000-8000-000000000002','Susan Otieno','staff@finesse.ac.ke','$2b$10$4idmRi3kzZJwJSKDgT9l1eckF4V1S3ALaArKlSuvJP4HrqETgZhgm',NULL,'Moi University',NULL,NULL,'staff'),
('b0000000-0000-4000-8000-000000000001','Amina Hassan','amina@students.finesse.ac.ke','$2b$10$4idmRi3kzZJwJSKDgT9l1eckF4V1S3ALaArKlSuvJP4HrqETgZhgm','EGM/027/2024','Moi University','BSc Electrical Engineering','2','student'),
('b0000000-0000-4000-8000-000000000002','Brian Kiprop','brian@students.finesse.ac.ke','$2b$10$4idmRi3kzZJwJSKDgT9l1eckF4V1S3ALaArKlSuvJP4HrqETgZhgm','SCI/114/2023','Moi University','BSc Computer Science','3','student'),
('b0000000-0000-4000-8000-000000000003','Cynthia Chebet','cynthia@students.finesse.ac.ke','$2b$10$4idmRi3kzZJwJSKDgT9l1eckF4V1S3ALaArKlSuvJP4HrqETgZhgm','BUS/052/2025','Moi University','BCom Finance','1','student'),
('b0000000-0000-4000-8000-000000000004','David Mutua','david@students.finesse.ac.ke','$2b$10$4idmRi3kzZJwJSKDgT9l1eckF4V1S3ALaArKlSuvJP4HrqETgZhgm','MED/009/2022','Moi University','MBChB Medicine','4','student');

INSERT INTO exam_periods (id, title, academic_year, semester, exam_start_date, exam_end_date, application_open, application_close, min_payment_percent, is_active) VALUES
('c0000000-0000-4000-8000-000000000001','Semester 1 End-of-Term Exams','2026/2027','Semester 1','2026-11-23','2026-12-11','2026-10-01','2026-11-15',100,1),
('c0000000-0000-4000-8000-000000000002','Semester 2 End-of-Term Exams','2025/2026','Semester 2','2026-04-20','2026-05-08','2026-03-25','2026-04-12',100,0);

INSERT INTO fee_records (id, student_id, student_name, email, course, academic_year, semester, total_fee, amount_paid, balance, is_cleared_for_exam, payment_ref, exception_granted_by, exception_note) VALUES
('d0000000-0000-4000-8000-000000000001','EGM/027/2024','Amina Hassan','amina@students.finesse.ac.ke','BSc Electrical Engineering','2026/2027','Semester 1',85000.00,85000.00,0.00,1,'MPESA-QJ81K2L9XA',NULL,NULL),
('d0000000-0000-4000-8000-000000000002','SCI/114/2023','Brian Kiprop','brian@students.finesse.ac.ke','BSc Computer Science','2026/2027','Semester 1',78000.00,52000.00,26000.00,0,'BANK-EQ-558201',NULL,NULL),
('d0000000-0000-4000-8000-000000000003','BUS/052/2025','Cynthia Chebet','cynthia@students.finesse.ac.ke','BCom Finance','2026/2027','Semester 1',72000.00,72000.00,0.00,1,'MPESA-QJ92M4T7BC',NULL,NULL),
('d0000000-0000-4000-8000-000000000004','MED/009/2022','David Mutua','david@students.finesse.ac.ke','MBChB Medicine','2026/2027','Semester 1',140000.00,120000.00,20000.00,1,'BANK-EQ-558977','a0000000-0000-4000-8000-000000000002','Exception granted: HELB disbursement confirmed, pending credit.'),
('d0000000-0000-4000-8000-000000000005','EGM/027/2024','Amina Hassan','amina@students.finesse.ac.ke','BSc Electrical Engineering','2025/2026','Semester 2',85000.00,85000.00,0.00,1,'MPESA-PL44A7ZQ21',NULL,NULL);

INSERT INTO exam_card_applications
 (id, student_uid, student_id, student_name, email, course, year_of_study, exam_period_id, academic_year, semester, status, rejection_reason, fee_record_id, amount_paid, total_fee, balance, manually_approved_by, manual_approval_note, card_issued_at, email_sent_at) VALUES
('e0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','EGM/027/2024','Amina Hassan','amina@students.finesse.ac.ke','BSc Electrical Engineering','2','c0000000-0000-4000-8000-000000000001','2026/2027','Semester 1','issued',NULL,'d0000000-0000-4000-8000-000000000001',85000.00,85000.00,0.00,NULL,NULL,'2026-10-12 09:14:00','2026-10-12 09:14:05'),
('e0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','SCI/114/2023','Brian Kiprop','brian@students.finesse.ac.ke','BSc Computer Science','3','c0000000-0000-4000-8000-000000000001','2026/2027','Semester 1','rejected','Your fees are not fully cleared. Outstanding balance: KSh 26,000. Please settle your fees and reapply.','d0000000-0000-4000-8000-000000000002',52000.00,78000.00,26000.00,NULL,NULL,NULL,NULL),
('e0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000004','MED/009/2022','David Mutua','david@students.finesse.ac.ke','MBChB Medicine','4','c0000000-0000-4000-8000-000000000001','2026/2027','Semester 1','approved',NULL,'d0000000-0000-4000-8000-000000000004',120000.00,140000.00,20000.00,'a0000000-0000-4000-8000-000000000002','Approved under fee exception (HELB pending credit).',NULL,NULL);

INSERT INTO tickets (id, student_id, student_name, issue_type, description, priority, status, staff_notes, assigned_staff_id, created_at) VALUES
('f0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','Brian Kiprop','payment_plan','I have paid KSh 52,000 of my Semester 1 fees and would like to arrange instalments for the balance before exams.','high','pending','',NULL,'2026-10-13 10:05:00'),
('f0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000003','Cynthia Chebet','fee_statement','Please issue my official fee statement for the 2026/2027 academic year. It is required for a bursary application.','medium','in_review','Statement being prepared. Collect from the finance office on Friday.','a0000000-0000-4000-8000-000000000002','2026-10-14 08:40:00'),
('f0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001','Amina Hassan','helb','My HELB loan was disbursed in September but it is not reflected on my fee statement. Reference attached in my payment details.','medium','resolved','HELB credit of KSh 40,000 has been posted to your account. Thank you for your patience.','a0000000-0000-4000-8000-000000000002','2026-10-05 14:20:00'),
('f0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000004','David Mutua','sponsorship','I need a sponsorship letter for my clinical attachment fees to be sent to the county sponsor.','low','pending','',NULL,'2026-10-15 16:55:00');

-- Appointment slots for the next 5 days (procedure skips dates already generated)
CALL generate_slots_for_date(CURDATE() + INTERVAL 1 DAY);
CALL generate_slots_for_date(CURDATE() + INTERVAL 2 DAY);
CALL generate_slots_for_date(CURDATE() + INTERVAL 3 DAY);
CALL generate_slots_for_date(CURDATE() + INTERVAL 4 DAY);
CALL generate_slots_for_date(CURDATE() + INTERVAL 5 DAY);

-- Book one demo slot: Cynthia's ticket, tomorrow at 10:00 AM (also moves nothing else; ticket is already in_review)
CALL book_slot(
  (SELECT id FROM slots WHERE start_time = TIMESTAMP(CURDATE() + INTERVAL 1 DAY, '10:00:00')),
  'b0000000-0000-4000-8000-000000000003', 'Cynthia Chebet',
  'f0000000-0000-4000-8000-000000000002');

INSERT INTO email_templates (template_key, subject, html, updated_by) VALUES
('exam_card','Your Finesse exam card for {{semester}}, {{academic_year}}',
 '<div style="font-family:Arial,sans-serif;max-width:560px"><h2 style="color:#1B7A8A">Exam Card {{card_number}}</h2><p>Hello {{to_name}},</p><p>Your exam card for <b>{{semester}}</b> ({{academic_year}}) has been approved. Present it at the examination hall.</p><p style="color:#64748B;font-size:12px">Finesse Campus Finance Office</p></div>','a0000000-0000-4000-8000-000000000001'),
('rejection','Update on your exam card application',
 '<div style="font-family:Arial,sans-serif;max-width:560px"><h2 style="color:#EF4444">Application not cleared</h2><p>Hello {{to_name}},</p><p>We could not clear your exam card application for <b>{{semester}}</b> ({{academic_year}}).</p><p>{{reason}}</p><p style="color:#64748B;font-size:12px">Finesse Campus Finance Office</p></div>','a0000000-0000-4000-8000-000000000001');

INSERT INTO sent_emails (email_type, to_email, to_name, semester, academic_year, card_number, html, delivered, created_by, sent_at) VALUES
('exam_card','amina@students.finesse.ac.ke','Amina Hassan','Semester 1','2026/2027','FC-00000001','<h2>Exam Card FC-00000001</h2><p>Your exam card is approved.</p>',1,'b0000000-0000-4000-8000-000000000001','2026-10-12 09:14:05'),
('rejection','brian@students.finesse.ac.ke','Brian Kiprop','Semester 1','2026/2027',NULL,'<h2>Application not cleared</h2><p>Outstanding balance: KSh 26,000.</p>',1,'b0000000-0000-4000-8000-000000000002','2026-10-13 09:50:00');

-- ----------------------------------------------------------------------------
--  Quick check (shows row counts after import)
-- ----------------------------------------------------------------------------
SELECT 'users' AS tbl, COUNT(*) AS `rows` FROM users
UNION ALL SELECT 'tickets', COUNT(*) FROM tickets
UNION ALL SELECT 'slots', COUNT(*) FROM slots
UNION ALL SELECT 'fee_records', COUNT(*) FROM fee_records
UNION ALL SELECT 'exam_periods', COUNT(*) FROM exam_periods
UNION ALL SELECT 'exam_card_applications', COUNT(*) FROM exam_card_applications
UNION ALL SELECT 'email_templates', COUNT(*) FROM email_templates
UNION ALL SELECT 'sent_emails', COUNT(*) FROM sent_emails;
