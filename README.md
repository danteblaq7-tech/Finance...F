# Finesse — Campus Finance Management (Supabase · Express · React · Expo)

A finance-office system for a university: students raise support tickets, book appointment slots and
apply for exam cards; finance staff work a ticket queue, import fee records, run exam periods and edit the
emails students receive. One **shared Supabase project** (database + sign-in + live updates) serves a
**web app**, a **mobile app** and a small **API**.

```
finesse/
├── database/supabase/      ← schema.sql, seed_demo.sql, reset.sql   (the database, as code)
├── database/legacy-mysql/  ← the old MySQL schema, kept for reference only
├── backend/                ← Node.js + Express REST API            → http://localhost:4000
├── web/                    ← React 18 + Vite + TypeScript         → http://localhost:5173
└── mobile/                 ← React Native (Expo SDK 58)           → Expo Go
```

```
                 ┌────────────────────── Supabase (cloud, shared by the whole team) ──────────────────────┐
                 │  Auth (sign-in, tokens)     Postgres (all data, security rules)     Realtime (live)    │
                 └───────▲──────────────────────────▲──────────────────────────────────────▲──────────────┘
   sign in / refresh     │                          │ SQL (server only)                    │ "something changed"
Browser ─► web :5173 ────┤                          │                                      │
   │            │  /api (Bearer = Supabase token)   │                                      │
   │            └─────────────► backend :4000 ──────┘                                      │
Phone ─► mobile (Expo Go) ─────► backend :4000                                             │
   └───────────────────────────────────────────────────────────────────────────────────────┘
```

**Why this makes "localhost" work for the whole team.** Nobody runs a database any more. Every teammate runs
the web app and the API on their *own* machine, but all of them point at the *same* Supabase project, so a
ticket raised on one laptop shows up on every other laptop and phone within a second.

* **Sign-in** is Supabase Auth. The apps sign in directly and Supabase refreshes the session automatically.
* **Every write** still goes through the Express API, which checks roles, validates input and runs the SQL.
* **Realtime:** the apps listen for changes and refetch what's on screen (details in §7).

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 18 or newer (20 LTS recommended) | `node -v` |
| A free Supabase account | — | https://supabase.com |

MySQL is **no longer needed**.

## 2. Project owner: one-time Supabase setup

Only **one** person on the team does this section. Everyone else skips to §3.

1. **Create a project** at https://supabase.com/dashboard ▸ *New project*. Pick the region closest to you and
   save the **database password** you choose.
2. **Collect four values.**

   | Value | Where | Goes into |
   |---|---|---|
   | Project URL | *Project Settings ▸ API* | `SUPABASE_URL`, `VITE_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_URL` |
   | `anon` / *publishable* key | *Project Settings ▸ API* | `SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
   | `service_role` / *secret* key | *Project Settings ▸ API* | `SUPABASE_SERVICE_ROLE_KEY` (**backend only**) |
   | **Session pooler** connection string | *Connect* button (top bar) ▸ *Session pooler* | `DATABASE_URL` |

   > ⚠ Use the **Session pooler** string (host ends in `pooler.supabase.com`), not "Direct connection".
   > The direct host is IPv6-only and fails on many home and campus networks. Replace `[YOUR-PASSWORD]` with
   > your database password; if it contains `@ # / ? :` URL-encode them (`@` → `%40`) or reset it to letters
   > and digits.

3. **Create the env files and fill them in** (from the project root):

   ```bash
   npm install            # tiny root helper (runs api + web together)
   npm run env:init       # creates backend/.env, web/.env, mobile/.env from the templates
   ```

   Open each `.env` and paste in the values above.

4. **Build the database** (tables, security rules, realtime, demo users and demo data):

   ```bash
   npm run setup          # installs backend/ and web/ dependencies
   npm run db:setup
   ```

   It's safe to run again: it never deletes data. (`npm run db:schema` = structure only,
   `npm run db:seed` = demo logins + data only. Prefer the dashboard? Paste
   `database/supabase/schema.sql` into *SQL Editor ▸ New query ▸ Run*, then run `npm run db:seed`.)

5. **Recommended dashboard hardening** — *Authentication ▸ Sign In / Providers ▸ Email*:
   turn **off "Allow new users to sign up"**. Students still register through the app (the API creates their
   account with the admin key), but strangers can no longer create accounts by calling Supabase directly with
   the public key. (Leave "Confirm email" however you like; API-created accounts are pre-confirmed.)

6. **Invite your teammates:** *Organization settings ▸ Team ▸ Invite*, so each can read the keys from the
   dashboard themselves. If you'd rather not, send them the values privately (see §3).

7. **Run `npm run dev`** and open http://localhost:5173 to check everything works (§5).

## 3. Teammates: getting running from GitHub

You do **not** create a database or run any `db:` command: the project owner already did. You only need
the Supabase values.

```bash
git clone <repo-url> && cd finesse
npm install
npm run env:init       # creates backend/.env, web/.env (and mobile/.env) from the templates
```

Fill the `.env` files with the team's values. Either ask the owner for them (send them **privately**:
a password manager, Signal… never GitHub, Slack channels or issues), or, once invited to the Supabase
project, copy them from the dashboard as in §2 step 2. Then:

```bash
npm run setup          # install backend + web dependencies (1–2 minutes the first time)
npm run dev            # API on :4000 + web app on :5173
```

You should see:

```
[api] ✔ Finesse API running on http://localhost:4000
[api]   database: aws-0-….pooler.supabase.com   auth: abcdefghijkl.supabase.co
[web]   ➜  Local:   http://localhost:5173/
```

Open **http://localhost:5173** and sign in with a demo account (§4). Stuck? See §9.

### What is safe to commit, and what is not

| File / value | In GitHub? | Why |
|---|---|---|
| `*/.env.example` | ✅ yes | Templates with placeholders only |
| `database/supabase/*.sql` | ✅ yes | The schema is code: teammates review changes like any other file |
| `backend/.env`, `web/.env`, `mobile/.env` | ❌ **never** | Real values; already in `.gitignore` |
| `SUPABASE_URL`, `anon` / *publishable* key | 🟡 public by design | Shipped inside every browser and phone. They're only safe because of the database security rules (§8). Still, keep them out of the repo so it can't be pointed at the wrong project |
| `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (contains the DB password) | ❌ **secret** | Full access; they bypass every security rule. Backend only |

**If a secret is ever pushed to GitHub:** treat it as leaked even if you delete the commit. Rotate it in the
dashboard (*Project Settings ▸ API* / *▸ Database ▸ Reset password*), update everyone's `.env`, and only then
clean up the history.

## 4. Sign in (demo accounts)

Every demo account has the password **`Finesse@2026`** (created by `npm run db:seed`).

| Role | Email | What to try |
|---|---|---|
| Staff | `staff@finesse.ac.ke` | ticket queue, applications, fee-record CSV import, exam periods, slots, email templates |
| Admin | `admin@finesse.ac.ke` | same as staff |
| Student (fees cleared) | `amina@students.finesse.ac.ke` | has an issued exam card: try **Print card** |
| Student (owes KSh 26,000) | `brian@students.finesse.ac.ke` | exam application was rejected: staff can override |
| Student | `cynthia@students.finesse.ac.ke` | has a booked appointment |
| Student (fee exception) | `david@students.finesse.ac.ke` | approved by exception: try **Generate & email my card** |

Or click **Create an account** to register a new student. The role is always `student`: it cannot be chosen
by the browser, the API *or* the sign-up metadata (a database trigger decides it).

⚠ The demo password is public in this README. Change it, or delete the demo users, before real use.

**Making a real staff member.** Create their account (they can register as a student, or you can add them
under *Authentication ▸ Users*), then in the dashboard's *SQL Editor*:

```sql
update public.profiles set role = 'staff' where email = 'someone@campus.ac.ke';   -- or 'admin'
```

### A 2-minute tour

1. **Student flow:** sign in as Cynthia ▸ *Raise Ticket* ▸ open it ▸ book an appointment slot.
2. **Staff flow:** in a *second browser* (or a private window) sign in as staff ▸ *Ticket Queue* ▸ open the
   ticket ▸ change status and add a note. Watch Cynthia's window update by itself.
3. **Exam cards:** as staff, *Fee Records* ▸ import a CSV (format below) ▸ as a student with a matching
   student ID, *Exam Card* ▸ **Apply**. The database decides approved/rejected from the fee record.
4. **Templates:** as staff, *Email Templates* ▸ edit the HTML in the code editor and watch the live preview.

**Fee CSV format** (header row required; column order doesn't matter):

```csv
student_id,student_name,email,course,total_fee,amount_paid,payment_ref
EGM/027/2024,Amina Hassan,amina@students.finesse.ac.ke,BSc Electrical Engineering,85000,85000,MPESA-123
```

## 5. Quick health check

| Check | Expected |
|---|---|
| http://localhost:4000/api/health | `{"ok":true,"db":"connected"}` |
| Sign in as `amina@…` | lands on *My Tickets* with 1 ticket |
| Sign in as `staff@…` | lands on *Ticket Queue* |
| `npm run check:api` (needs `mobile/.env`) | "All good: the backend matches what the mobile app expects." |

## 6. Mobile app (React Native / Expo)

Same API, same demo accounts, same live updates.

**You need:** the **Expo Go** app (keep it up to date: this project uses Expo SDK 58) and your phone on the
**same Wi-Fi** as your computer.

```bash
npm run env:init            # if you haven't: creates mobile/.env. Fill in the two EXPO_PUBLIC_SUPABASE_* values
npm run dev --prefix backend   # the API must be running (or `npm run dev` to start the web app too)
npm run setup:mobile        # first time only, a few minutes
npm run mobile              # prints a QR code: scan with Expo Go (Android) or the Camera app (iPhone)
```

After editing `mobile/.env`, restart Expo with the cache cleared: `npx expo start -c`.

**Finding your backend (the one thing that trips people up).** The phone talks to **Supabase directly over
the internet** (sign-in, live updates), but to the **Finesse API on your computer** for everything else, and on
a phone `localhost` means the phone itself. The app works out your computer's address from Expo
automatically and tries `http://<your-computer>:4000`. If sign-in says *"Can't reach the server"*:

1. Open the **Server** line at the bottom of the sign-in screen and tap **change**.
2. Type your computer's Wi-Fi address and port, e.g. `192.168.1.5:4000`, then tap **Test**. It should say
   *Connected. Database: connected.* Tap **Save**.
   * Windows: `ipconfig` ▸ *IPv4 Address*. macOS: `ipconfig getifaddr en0`. Linux: `hostname -I`.
3. Windows Firewall: allow Node on **Private** networks when it asks.
4. Don't start Expo with `--tunnel`: a tunnel carries the app but not your API on port 4000.
5. Check the API from your computer first: `npm run check:api -- 192.168.1.5:4000`.

| | Students | Staff / admin |
|---|---|---|
| Tickets | raise, list, view replies, cancel | queue with filters, open a ticket, set status/priority, write notes |
| Appointments | pick a day and time, book / cancel | see who booked |
| Exam card | apply, see why rejected, re-apply, generate the card, view it on screen | list applications, **approve manually** with a recorded reason |
| Fees | see your own balance on the exam screen | search records, **grant exceptions** |
| Account | profile, theme, change password, server address, sign out | same |

Web-only for now: fee **CSV import**, creating **exam periods**, **generating slots**, the **email template editor**.

**Release builds:** a store build must call the API over **HTTPS** (build with
`EXPO_PUBLIC_API_URL=https://your-api`). Supabase itself is already HTTPS.

## 7. How live updates work

The database publishes changes to `tickets`, `slots`, `exam_card_applications`, `fee_records` and
`exam_periods` (Supabase Realtime). When the web or mobile app is signed in it subscribes, and whenever a
change arrives it refetches whatever is on screen **through the API**. So the API's permission rules stay the
single source of truth, and Realtime is just the "something changed" bell.

* A student only receives events for rows they're allowed to read (their own tickets and applications).
* The screens still poll every 15 seconds as a safety net, so a dropped connection degrades to the old
  behaviour instead of breaking.
* To see it: open the app as a student in one window and as staff in another, change a ticket's status as
  staff, and the student's window updates without a refresh.

## 8. Security model (read this before adding tables)

Supabase publishes every table in the `public` schema over a REST API that **anyone holding the public key can
call**. What stops them is **Row Level Security (RLS)**, set up in `schema.sql`:

* All tables have RLS **on**. Signed-in users may only **read** what they're entitled to (own tickets / own
  fee records / own applications; staff see all). Nobody can write through the public API: the API does all
  writes with a privileged server-side role.
* **Who booked a slot** is kept in a separate staff-only table (`slot_bookings`), so it can't leak to students
  through Realtime. The slots table itself only says *taken / free*.
* Functions that change data (`book_slot`, …) can't be called from browsers.
* Roles can't be self-assigned: a trigger creates every new profile as `student`.

**When you add a table:** enable RLS (`alter table … enable row level security;`) and add a policy,
otherwise it is readable and writable by the whole internet. Put the change in `database/supabase/schema.sql`
(it's written to be re-runnable) and tell the team to run `npm run db:schema` once.

## 9. Troubleshooting

| You see | Cause / fix |
|---|---|
| Web/mobile shows **"Finesse needs its Supabase settings"** | `web/.env` / `mobile/.env` missing or still has placeholders. `npm run env:init`, fill it in, **restart** `npm run dev` (Vite) or `npx expo start -c` (Expo). They only read `.env` at startup. |
| `✖ Missing SUPABASE_URL …` / `…still has the placeholder text` | `backend/.env` is missing or unfilled. See §3. |
| `✖ Cannot connect … ENOTFOUND / ENETUNREACH` | You used the *Direct connection* string (IPv6-only). Use the **Session pooler** string. |
| `password authentication failed` | Wrong DB password. Reset it under *Project Settings ▸ Database*. With the pooler the username is `postgres.<project-ref>`. |
| `Tenant or user not found` | Wrong pooler host/region, or the username isn't `postgres.<project-ref>`. Re-copy the string from *Connect*. |
| `DATABASE_URL is not a valid URL` | Special characters in the password. URL-encode them (`@` → `%40`, `#` → `%23`) or reset the password. |
| Hangs, then timeout | No internet, or the free project is **paused** (idle ~7 days). Restore it in the dashboard. |
| `✖ …Finesse tables do not exist yet` | The owner hasn't run `npm run db:setup` for this project yet (§2 step 4). |
| `✖ Supabase rejected SUPABASE_SERVICE_ROLE_KEY` | Wrong key, or `SUPABASE_URL` belongs to a different project than the key. |
| Login says "Incorrect email or password" | Demo password is `Finesse@2026` (capital F, `@`). If the demo users were never created, run `npm run db:seed`. |
| Signed in, then bounced back to login | The API rejected the session. Check `SUPABASE_URL` matches in `backend/.env` and `web/.env`; check the `[api]` terminal for errors. |
| Browser shows **"Cannot reach the Finesse API"** | The API isn't running. Check the `[api]` terminal and http://localhost:4000/api/health. |
| `EADDRINUSE :4000` or `:5173` | Port in use. Stop the other process, or set `PORT` in `backend/.env` (and the proxy target in `web/vite.config.ts`). |
| Appointment slots empty | Slots are generated for the 5 days after seeding. Staff can generate more under *Appointment Slots*. |
| Live updates don't arrive | Check *Database ▸ Replication* lists the tables (re-run `npm run db:schema`); the 15-second polling still keeps pages fresh meanwhile. |

## 10. Tests

```bash
npm test               # backend integration tests + web unit/component tests
npm run test:mobile    # mobile tests (no phone needed)
cd web && npm run typecheck && npm run lint
cd mobile && npx tsc --noEmit && npx expo lint
```

⚠ **The backend tests run against the real Supabase project in `backend/.env`** and create real users,
tickets and bookings. They delete what they create when they finish, but because the whole team shares that
project, ideally create a second, free "finesse-dev" project for testing (or run them when nobody is demoing).

## 11. API reference

All routes are under `/api`, send/return JSON and (except `health`/`register`) need
`Authorization: Bearer <Supabase access token>`. **Signing in is done with Supabase directly**
(`supabase.auth.signInWithPassword`), not through this API. Errors look like `{ "error": "message" }`;
validation errors add `details: [{ field, message }]`.

| Method & path | Who | What |
|---|---|---|
| `GET /health` | anyone | API + database status |
| `POST /auth/register` | anyone | create a **student** account (then sign in with Supabase) |
| `GET /auth/me` · `POST /auth/change-password` | signed in | current profile (with role) · change password |
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

## 12. Going beyond localhost

* Host the API somewhere with HTTPS (Render, Railway, Fly…). Set its env vars there (never in the repo),
  `NODE_ENV=production`, and `CORS_ORIGIN` to the web app's URL.
* `npm run build` the web app (output in `web/dist`), host it on any static host, and build with
  `VITE_API_URL` set to the API's public URL.
* Mobile release builds need `EXPO_PUBLIC_API_URL=https://…`.
* **Change the demo passwords** (or delete the demo users).
* Supabase's free tier pauses idle projects and has no automatic backups: upgrade before going live.
* **Real email:** by default emails are stored in `sent_emails` (visible under *Email Templates ▸ Sent emails*).
  To deliver them, fill in the `SMTP_*` values in `backend/.env`.
* Registration and password changes are rate-limited (20 attempts / 15 min per IP); sign-in attempts are
  rate-limited by Supabase.

## 13. Known limits

* **How this migration was verified.** The new database schema, security rules, triggers and every API route
  were tested against a real **PostgreSQL 16**. The 18 backend integration tests, the web tests (24) and
  the mobile tests (48) pass. Supabase's own services (Auth over HTTP, Realtime websocket, the connection
  pooler) were **not** reachable from where this was built, so Auth was exercised through a stand-in with the
  same HTTP shape. Expect to report small differences the first time you run it against your real project,
  especially **Realtime** (never run live). If live updates don't arrive, see §9; the 15-second polling covers it.
* The mobile app has not been run on a physical device or emulator, only type-checked, linted and tested in Jest.
* Live updates trigger a refetch; they don't patch the screen in place. Fine at campus scale.
* Ticket **file attachments** and push notifications are not implemented.
* No password-reset-by-email flow yet (an admin can reset a password in *Authentication ▸ Users*;
  `change-password` works for signed-in users).
* Dates: appointment times are stored as campus wall-clock time; event times (created, issued…) are stored
  with a time zone and shown in each viewer's local time. "Today" is computed in `Africa/Nairobi`: change
  `app_today()` in `schema.sql` if the campus is elsewhere.
* The API checks each request's token with Supabase (cached for 15 s); a deleted/banned user is cut off within
  that window.

## 14. Project layout

```
database/supabase/
  schema.sql      tables · security (RLS) · triggers · SQL functions · realtime · default email templates (re-runnable)
  seed_demo.sql   demo data (run by `npm run db:seed`)
  reset.sql       ⚠ drops every Finesse table (run by `npm run db:reset`, asks first)
backend/src/
  server.js, app.js, config.js, db.js (Postgres), supabase.js (admin client), mailer.js
  middleware/  auth.js (verifies the Supabase token + loads the profile), errors.js
  routes/      auth, tickets, slots, fees, exam (periods + applications), templates
backend/scripts/db-setup.js      npm run db:schema | db:seed | db:setup | db:reset
backend/test/api.test.js         18 integration tests
web/src/
  lib/         api client, supabase client, realtime hook, types, CSV parser, helpers
  components/  UI kit, Layout, route guards, setup screen
  features/    auth, tickets, exam (student + staff), slots, templates (Monaco editor)
  test/        24 tests
mobile/src/
  app/         Expo Router routes: (auth), (student) tabs, (staff) tabs, role-protected
  screens/     Auth, Tickets, Exam, Staff, Profile screens
  components/  UI kit, list screen, form helpers
  lib/         API client, supabase client (keychain session), realtime hook, types, formatters
  context/     auth session   theme/  dark+light tokens   __tests__/  48 tests
mobile/scripts/check-api.mjs     contract check against a running backend
scripts/init-env.mjs             npm run env:init
```
