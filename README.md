# Finesse — Campus Finance Management (MySQL · Express · React)

A finance-office system for a university: students raise support tickets, book appointment
slots and apply for exam cards; finance staff work a ticket queue, import fee records, run exam
periods and edit the emails students receive. One database and one API serve both a **web app**
and a **mobile app**.

```
finesse/
├── database/finesse_mysql.sql   ← schema + demo data (you already imported this in Workbench)
├── backend/                     ← Node.js + Express REST API  → http://localhost:4000
├── web/                         ← React 18 + Vite + Tailwind (plain JavaScript) → http://localhost:5173
└── mobile/                      ← React Native (Expo SDK 58) + Expo Router (plain JavaScript) → Expo Go
```

```
Browser ──► web (Vite, :5173) ──/api proxy──┐
                                            ├──► backend (Express, :4000) ──mysql2──► MySQL (:3306)
Phone ──► mobile (Expo Go) ──Wi-Fi (HTTP)───┘
```

Neither app talks to MySQL. They call the API; the API checks the signed-in user's role,
validates input, and runs the SQL. Passwords are bcrypt-hashed and sessions are signed JWTs, so an
account created on the web works on the phone and the other way round, and both see the same tickets,
slots and exam applications.

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 18 or newer (20 LTS recommended) | `node -v` |
| MySQL Server | 8.0 (what Workbench connects to) | it's running, and you can open it in Workbench |

## 2. Database (already done — just verify)

You imported `database/finesse_mysql.sql` in Workbench. Confirm it worked by running this in a
Workbench query tab:

```sql
SELECT COUNT(*) AS users FROM finesse.users;      -- expect 6
SELECT COUNT(*) AS slots FROM finesse.slots;      -- expect 90
```

If the `finesse` database is missing, re-run the file: **File ▸ Open SQL Script ▸ the file ▸ ⚡ Execute**.
(It drops and recreates `finesse`, so anything you added is reset.)

Note your MySQL **host, port, username and password** — the ones you type into Workbench's
connection. You need them in the next step.

## 3. Configure the backend

Create `backend/.env` from the template:

```bash
# macOS / Linux / Git Bash
cp backend/.env.example backend/.env
# Windows PowerShell / cmd
copy backend\.env.example backend\.env
```

Open `backend/.env` and set:

```ini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root                  # the user you use in Workbench
DB_PASSWORD=your_password     # ← that user's password
DB_NAME=finesse

JWT_SECRET=<paste a long random value>
```

Generate a good `JWT_SECRET` (run from the project root, paste the output):

```bash
npm run gen-secret
```

> `.env` holds secrets and is git-ignored. Never commit it or share it.

## 4. Install and run

From the project root (`finesse/`):

```bash
npm install        # installs the tiny root helper that runs both servers at once
npm run setup      # installs backend/ and web/ dependencies (1–2 minutes the first time)
npm run dev        # starts the API on :4000 and the web app on :5173
```

You should see:

```
[api] ✔ Finesse API running on http://localhost:4000  (database: finesse)
[web]   ➜  Local:   http://localhost:5173/
```

Open **http://localhost:5173**.

If you'd rather use two terminals: `cd backend && npm run dev`, and `cd web && npm run dev`.

## 5. Sign in (demo accounts)

Every demo account has the password **`Finesse@2026`**.

| Role | Email | What to try |
|---|---|---|
| Staff | `staff@finesse.ac.ke` | ticket queue, applications, fee-record CSV import, exam periods, slots, email templates |
| Admin | `admin@finesse.ac.ke` | same as staff |
| Student (fees cleared) | `amina@students.finesse.ac.ke` | has an issued exam card — try **Print card** |
| Student (owes KSh 26,000) | `brian@students.finesse.ac.ke` | exam application was rejected — staff can override |
| Student | `cynthia@students.finesse.ac.ke` | has a booked appointment |
| Student (fee exception) | `david@students.finesse.ac.ke` | approved by exception — try **Generate & email my card** |

Or click **Create an account** to register a new student (the role is always `student`; the
server ignores any role sent by the browser).

### A 2-minute tour

1. **Student flow:** sign in as Cynthia → *Raise Ticket* → open it → book an appointment slot.
2. **Staff flow:** sign out, sign in as staff → *Ticket Queue* → open the ticket → change status and
   add a note. Sign back in as the student: the note appears (the page refreshes itself every 15 s).
3. **Exam cards:** as staff, *Fee Records* → import a CSV (format below) → as a student with a matching
   student ID, *Exam Card* → **Apply**. The database decides approved/rejected from the fee record.
4. **Templates:** as staff, *Email Templates* → edit the HTML in the code editor and watch the live preview.

**Fee CSV format** (header row required; column order doesn't matter):

```csv
student_id,student_name,email,course,total_fee,amount_paid,payment_ref
EGM/027/2024,Amina Hassan,amina@students.finesse.ac.ke,BSc Electrical Engineering,85000,85000,MPESA-123
```

## 5b. Mobile app (React Native / Expo)

The phone app is in `mobile/`. It uses the same API and the same demo accounts as the web app.

**What you need:** the **Expo Go** app from the App Store / Google Play (keep it up to date: this
project uses Expo SDK 58, and Expo Go only opens projects that match its current SDK), and your phone on
the **same Wi-Fi** as your computer.

```bash
# 1. the API must be running (database + API). From the project root, in one terminal:
npm run dev --prefix backend          # or `npm run dev` to also start the web app

# 2. in a second terminal, install the mobile dependencies (first time only, a few minutes)
npm run setup:mobile

# 3. start the mobile app
npm run mobile
```

A QR code appears. Scan it with **Expo Go** (Android) or the **Camera app** (iPhone). Sign in with any
demo account from the table above.

**Finding your backend (the one thing that trips people up).** On a phone, `localhost` means the
phone itself. The app works out your computer's address from Expo automatically and tries
`http://<your-computer>:4000`. If sign-in says *"Can't reach the server"*:

1. Open the **Server** line at the bottom of the sign-in screen and tap **change**.
2. Type your computer's Wi-Fi address and port, e.g. `192.168.1.5:4000`, then tap **Test**. It should say *Connected. Database: connected.* Tap **Save**.
   * Windows: run `ipconfig` and use the *IPv4 Address*. macOS: `ipconfig getifaddr en0`. Linux: `hostname -I`.
3. Windows Firewall: when Node first starts it asks to allow network access. Allow it on **Private** networks, or the phone can't connect.
4. Don't start Expo with `--tunnel`: a tunnel carries the app but not your API on port 4000.
5. To check the API from your computer before blaming the phone: `npm run check:api` (or `npm run check:api -- 192.168.1.5:4000`).

Emulators: the Android emulator and iOS simulator work too; the address is found automatically.

**What's in the mobile app**

| | Students | Staff / admin |
|---|---|---|
| Tickets | raise, list, view replies, cancel | queue with filters, open a ticket, set status/priority, write notes |
| Appointments | pick a day and time, book / cancel | see who booked |
| Exam card | apply, see why rejected, re-apply, generate the card (emailed to you), view it on screen | list applications, **approve manually** with a recorded reason |
| Fees | see your own balance on the exam screen | search records, **grant exceptions** |
| Account | profile, dark/light theme, change password, server address, sign out | same |

Web-only for now (they suit a keyboard and a big screen): fee **CSV import**, creating **exam periods**,
**generating slots**, and the **email template editor**. Not in either app yet: push notifications and
ticket file attachments.

**Mobile tests and checks** (none of these need a phone):

```bash
npm run test:mobile     # 39 tests, including the real Expo Router routes, role guards and sign-in flow
npm run check:api       # asks the RUNNING backend for everything the app reads and verifies the shape
cd mobile && npx expo lint
```

**Release builds:** the app talks plain `http://` to your computer during development, which Expo Go
allows. A real store build must use **HTTPS** (Android and iOS block plain HTTP in production), so host
the API behind HTTPS and build with `EXPO_PUBLIC_API_URL=https://your-api`. Store builds use Expo's EAS
service, which is not set up in this project.

---

## 6. Troubleshooting

| You see | Cause / fix |
|---|---|
| `✖ Cannot connect to MySQL … ER_ACCESS_DENIED_ERROR` | Wrong `DB_USER` / `DB_PASSWORD` in `backend/.env`. Use exactly what Workbench uses. |
| `… ECONNREFUSED 127.0.0.1:3306` | MySQL isn't running, or runs on another port. Start the MySQL service; check `DB_PORT`. |
| `… ER_BAD_DB_ERROR Unknown database 'finesse'` | The SQL file wasn't imported (step 2). |
| `✖ Missing JWT_SECRET` | You haven't created `backend/.env` (step 3). |
| `Client does not support authentication protocol` | Very old MySQL client config. Run in Workbench: `ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'your_password';` |
| Browser shows **"Cannot reach the server"** | The API isn't running. Check the `[api]` line in the terminal; open http://localhost:4000/api/health — it should say `"db":"connected"`. |
| `EADDRINUSE :4000` or `:5173` | Something else is using the port. Stop it, or set `PORT` in `backend/.env` (and change the proxy target in `web/vite.config.js` to match). |
| Login says "Incorrect email or password" | Demo password is `Finesse@2026` (capital F, `@`). If you re-imported the SQL, the demo data was reset. |
| Appointment slots empty | Slots are generated for the 5 days after the import. Staff can generate more under *Appointment Slots*. |

## 7. Tests

```bash
npm test            # backend integration tests + web unit/component tests
```

⚠️ The **backend tests run against the real database** in `backend/.env` and create real rows
(tickets, users, slot bookings). Re-import `finesse_mysql.sql` afterwards to reset the demo data,
or point `DB_NAME` at a scratch copy first.

Web: `cd web && npm run lint && npm test`.

## 8. API reference

All routes are under `/api`, send/return JSON, and (except health/login/register) need
`Authorization: Bearer <token>`. Errors look like `{ "error": "message" }`; validation errors add
`details: [{ field, message }]`. Response objects use the MySQL column names; the exact fields each
screen reads are listed in `SHAPES` in `mobile/scripts/check-api.mjs`, which `npm run check:api`
verifies against the running server.

| Method & path | Who | What |
|---|---|---|
| `GET /health` | anyone | API + database status |
| `POST /auth/register` | anyone | create a **student** account |
| `POST /auth/login` | anyone | returns `{ token, user }` |
| `GET /auth/me` · `POST /auth/change-password` | signed in | current user · change password |
| `GET /tickets` · `POST /tickets` | student: own · staff: all | list · raise (students only) |
| `GET /tickets/:id` | owner or staff | one ticket (404 for other students') |
| `PATCH /tickets/:id` | student: cancel only · staff: status/priority/notes | update |
| `POST /tickets/:id/book` · `DELETE /tickets/:id/booking` | owner or staff | book / cancel appointment (atomic) |
| `GET /slots/dates` · `GET /slots?date=` | signed in | dates with free slots · slots for a day |
| `POST /slots/generate` | staff | create 30-min slots for a date |
| `GET /fee-records/mine` | student | own fee records |
| `GET /fee-records` · `POST /fee-records/import` · `POST /fee-records/:id/exception` | staff | list · bulk upsert · grant exception |
| `GET /exam-periods` | signed in | list |
| `POST /exam-periods` · `PATCH /exam-periods/:id` | staff | create · activate/deactivate |
| `GET /applications` · `POST /applications` | student: own · staff: all | list · apply (students) |
| `POST /applications/:id/approve` | staff | manual approval with a reason |
| `POST /applications/:id/issue` | student (own, approved) | issue card + store/send email |
| `GET/PUT /templates` · `GET /emails` | staff | email templates · sent-email outbox |

## 9. Going beyond localhost

* Set `NODE_ENV=production` and a real `JWT_SECRET` (the API refuses to start with the example value).
* **Don't run the app as MySQL `root`.** Create a least-privilege user:
  ```sql
  CREATE USER 'finesse_app'@'localhost' IDENTIFIED BY 'a-strong-password';
  GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON finesse.* TO 'finesse_app'@'localhost';
  ```
  then use it as `DB_USER` / `DB_PASSWORD`.
* **Change the demo passwords** (or delete the demo users) before real use.
* Serve over **HTTPS**. Build the web app with `npm run build` (output in `web/dist`), host it on any
  static host, and set `VITE_API_URL` to the API's public URL at build time and `CORS_ORIGIN` on the API
  to the web app's URL.
* **Real email:** by default emails are stored in the `sent_emails` table (visible under *Email
  Templates ▸ Sent emails*). To actually deliver them, fill in the `SMTP_*` values in `backend/.env`.
* Login/registration are rate-limited (20 attempts / 15 min per IP).

## 10. Known limits

* **Mobile app verified without a phone.** It lints, passes 39 tests, bundles for both iOS
  and Android, and its requests were checked against the live API. It has **not** been run on a physical
  device or emulator in my environment, so expect to report small layout or platform quirks.
* Live updates are **polling** (every 15 s), not WebSockets.
* Ticket **file attachments** are not implemented in this version.
* No password-reset-by-email flow yet (an admin can reset a hash in the database; `change-password`
  works for signed-in users).
* Dates are shown in the viewer's local time and stored as the database server's wall-clock time;
  keep the server and users in the same time zone (e.g. Africa/Nairobi) for slot times to line up.
* Tested against **MariaDB 10.11** (MySQL-compatible) in a sandbox and in jsdom — not yet clicked
  through in a real browser against MySQL 8. Report anything odd.

## 11. Project layout

```
backend/src/
  server.js, app.js, config.js, db.js, mailer.js
  middleware/  auth.js (JWT + roles), errors.js
  routes/      auth, tickets, slots, fees, exam (periods + applications), templates
backend/test/api.test.js         16 integration tests
web/src/                         (plain JavaScript: components are .jsx, everything else .js)
  lib/         api client, CSV parser, helpers, constants
  components/  UI kit, Layout, route guards
  features/    auth, tickets, exam (student + staff), slots, templates (Monaco editor)
  test/        21 tests
web/jsconfig.json                gives your editor the "@/..." import alias
mobile/src/
  app/         Expo Router routes: (auth), (student) tabs, (staff) tabs, role-protected
  screens/     Auth, Tickets, Exam, Staff, Profile screens
  components/  UI kit (themed Button, Field, Card…), list screen, form helpers
  lib/         API client (finds your computer on the network), formatters, constants, secure storage
  context/     auth session   theme/  dark+light tokens from the original Finesse app
  __tests__/   39 tests    test-utils/  fake API for tests
mobile/jsconfig.json           the "@/..." import alias (used by Metro, and by ESLint to resolve imports)
mobile/scripts/check-api.mjs   contract check against a running backend
```
