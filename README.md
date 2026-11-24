# Finesse — Campus Finance Management (Supabase · Express · React · Expo)

A finance-office system for a university: students raise support tickets, book appointment slots and
apply for exam cards; finance staff work a ticket queue, import fee records, run exam periods and edit the
emails students receive. One **shared Supabase project** (database + sign-in + live updates) serves a
**web app**, a **mobile app** and a small **API**.

```
finesse/
├── supabase/migrations/    ← ordered Supabase CLI schema migrations
├── database/supabase/      ← legacy schema reference, local demo seed and reset SQL
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
| Supabase CLI | Current | `supabase --version` |

MySQL is **no longer needed**.
On Windows, install the CLI with Scoop (`scoop bucket add supabase https://github.com/supabase/scoop-bucket.git`, then `scoop install supabase`).

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

   Open each `.env` and fill in the values above. Mobile also requires `EXPO_PUBLIC_API_URL`; set it to the API's reachable URL (for local physical-device testing use your computer's LAN IP and port 4000).

   **Use staging without touching development `.env` files (PowerShell):** copy `backend/.env.staging.example`,
   `web/.env.staging.example` and `mobile/.env.staging.example` to their corresponding `.env.staging` names,
   then replace the service-role key, anon key and database URI with values from Supabase project
   `jqmxcnilrwgirsdufzjn`. These `.env.staging` files are git-ignored. Run each command in its own terminal:

   ```powershell
   # Terminal 1: API connects to the staging database/Auth project.
   Set-Location .\backend
   $env:DOTENV_CONFIG_PATH = '.env.staging'
   npm run dev

   # Terminal 2: Vite loads web/.env.staging.
   Set-Location .\web
   npm run dev -- --mode staging

   # Terminal 3: Expo reads staging values into this process; the example API URL is Android-emulator-only.
   Set-Location .\mobile
   Get-Content .\.env.staging | ForEach-Object {
     if ($_ -match '^\s*([^#=]+)=(.*)$') {
       [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
     }
   }
   npx expo start
   ```

   For a physical phone, replace the mobile API URL with a development URL reachable from that phone. Do not use
   these local HTTP addresses in an EAS production build; production API URLs must be HTTPS. Ensure staging
   migrations are applied before starting the API.

4. **Apply the database migrations**:

   ```bash
   supabase link --project-ref <project-ref>
   npm run db:migrate
   ```

   `db:migrate` applies pending files in `supabase/migrations/`; it does not seed data. New blank projects get the schema from the initial migration. Do not paste `schema.sql` into the dashboard or run demo seed data against a hosted project. The ticket-response migration backfills each existing non-empty staff note; legacy rows have no stored author and use the ticket's `updated_at` as the closest available timestamp. The student registry/normalization migration is currently intended for **staging only**; apply it to staging, not production, until separately approved. It fails clearly if existing profile numbers collide after normalization; resolve those duplicates before retrying.

   **First admin (one-time):** after all migrations are applied, use the staging-specific script below. It reads `backend/.env.staging` (overriding inherited process values), refuses unless both Supabase URL and database URL identify staging project `jqmxcnilrwgirsdufzjn`, then checks required migrations before any Auth changes. It refuses if any admin already exists, and can recover an existing Auth user by creating or promoting its profile. It generates a temporary password in memory, displays it once after success, and requires a password change at first sign-in. It does not write the password to a file, environment variable, database, or application log. Protect the terminal output and do not enable session transcription while running it. While the profile's `must_change_password` flag is set, the backend rejects authenticated requests other than `POST /api/auth/change-password`; Supabase Auth app metadata is used only to route the UI.

   From the repository root in PowerShell, fill in `backend/.env.staging` once from its example, then run:

   ```powershell
   $env:BOOTSTRAP_ADMIN_NAME = 'First Admin Name'
   $env:BOOTSTRAP_ADMIN_EMAIL = 'admin@example.com'
   npm run bootstrap:admin:staging
   Remove-Item Env:BOOTSTRAP_ADMIN_NAME, Env:BOOTSTRAP_ADMIN_EMAIL
   ```

   The command never reads or changes `backend/.env`. The same script can be run from `backend/` with `npm run bootstrap:admin:staging`. The temporary password is printed once to the terminal after the transaction commits; keep it private and deliver it to the admin securely.

   **Student signup:** student numbers are normalized (trimmed, uppercased, whitespace/slashes/dashes collapsed to `/`) before validation and storage. Default format is `^[A-Z]{2,6}/\d{3,4}/\d{2}$`, for example `COM/072/23` or `COM/1234/23`; override it with `STUDENT_ID_PATTERN` if campus formats change. Student email domains are not restricted (students may use Gmail). When `student_registry` contains any rows, signup requires an active exact number in that registry; when it is empty, the API falls back to the pattern and logs a startup warning.

   **Staging registry import:** prepare UTF-8 CSV with a header `student_number,course,active` (`active` optional; defaults true). The importer normalizes numbers, validates the configured pattern, rejects duplicate normalized numbers, and upserts records. It is explicitly restricted to staging project `jqmxcnilrwgirsdufzjn`. Put the CSV in `backend/`, then run:

   ```powershell
   Set-Location .\backend
   $env:DOTENV_CONFIG_PATH = '.env.staging'
   npm run registry:import -- .\student-registry.csv
   ```

   The command uses the staging `DATABASE_URL` from `backend/.env.staging`; it does not read or modify `backend/.env`.

   For an isolated **local-only demo** instead: run `supabase start`, then `supabase db reset` to apply migrations locally. Point `backend/.env`'s `SUPABASE_URL` and `DATABASE_URL` at the local services (get local keys with `supabase status -o env`), then run `npm run db:seed`. The seed command refuses production mode and any non-local Auth or database URL.

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
[api] ✔ Finesse API listening on 0.0.0.0:4000
[api]   database: aws-0-….pooler.supabase.com   auth: abcdefghijkl.supabase.co
[web]   ➜  Local:   http://localhost:5173/
```

Open **http://localhost:5173** and sign in with a demo account (§4). Stuck? See §9.

### Test the web app from a phone on your Wi-Fi

The Vite frontend (`5173`) and Express API (`4000`) listen on all IPv4 interfaces during local development.
On the laptop, run both services from the project root:

```powershell
npm run dev
```

Or, in separate terminals, run `npm run dev --prefix backend` and `npm run dev --prefix web`.
Find the laptop's Wi-Fi IPv4 address with `ipconfig` (under **Wireless LAN adapter Wi-Fi**), then open
`http://<laptop-LAN-IPv4>:5173` on the phone while it is on the same Wi-Fi network. Vite also prints its
**Network** URL on startup. The API listens at `http://<laptop-LAN-IPv4>:4000`; its health check is
`http://<laptop-LAN-IPv4>:4000/api/health`.

The web app sends API requests to the same-origin `/api` path. Keep `VITE_API_URL` empty in `web/.env`:
Vite forwards those requests to `127.0.0.1:4000` on the laptop, so the phone never tries to contact its own
localhost and the web API traffic does not require cross-origin access. `VITE_API_URL` is only needed when
the frontend and API are hosted separately (for example, in production).

`backend/.env` uses the comma-separated `CORS_ORIGIN` allowlist. Add the exact frontend origin
`http://<laptop-LAN-IPv4>:5173` alongside existing origins when a browser connects directly to the API;
do not use `*`. The Vite proxy setup itself is same-origin and does not rely on CORS. Restart the backend
after changing `CORS_ORIGIN`. Auth and Realtime connect directly to the configured Supabase project over
the network; there is no local WebSocket server to expose.

On Windows, allow Node.js (or TCP ports **5173** and **4000**) through Windows Defender Firewall on the
**Private** network profile if prompted. Do not expose these development ports on Public networks. The QR
scanner's browser camera may require HTTPS; plain HTTP on a phone's LAN address is not generally a secure
context, though the rest of the app can be tested.

### What is safe to commit, and what is not

| File / value | In GitHub? | Why |
|---|---|---|
| `*/.env.example` | ✅ yes | Templates with placeholders only |
| `supabase/migrations/*.sql` | ✅ yes | Ordered database changes, applied through Supabase CLI |
| `backend/.env`, `web/.env`, `mobile/.env` | ❌ **never** | Real values; already in `.gitignore` |
| `SUPABASE_URL`, `anon` / *publishable* key | 🟡 public by design | Shipped inside every browser and phone. They're only safe because of the database security rules (§8). Still, keep them out of the repo so it can't be pointed at the wrong project |
| `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (contains the DB password) | ❌ **secret** | Full access; they bypass every security rule. Backend only |

**If a secret is ever pushed to GitHub:** treat it as leaked even if you delete the commit. Rotate it in the
dashboard (*Project Settings ▸ API* / *▸ Database ▸ Reset password*), update everyone's `.env`, and only then
clean up the history.

## 4. Local demo accounts only

The demo accounts and shared password below exist only in the local Supabase CLI project. `npm run db:seed` refuses production mode and hosted Auth/database URLs; never copy this data to a hosted project.

| Role | Email | What to try |
|---|---|---|
| Staff | `staff@finesse.ac.ke` | ticket queue, applications, fee-record CSV import, exam periods, slots, email templates |
| Admin | `admin@finesse.ac.ke` | same as staff |
| Lecturer | `lecturer@finesse.ac.ke` | scan exam cards and sign units (*Scan Cards*, *My Units*) |
| Student (fees cleared) | `amina@students.finesse.ac.ke` | has an issued exam card: try **Print card** |
| Student (owes KSh 26,000) | `brian@students.finesse.ac.ke` | exam application was rejected: staff can override |
| Student | `cynthia@students.finesse.ac.ke` | has a booked appointment |
| Student (fee exception) | `david@students.finesse.ac.ke` | approved by exception: try **Generate & email my card** |

Or click **Create an account** to register a new student. The role is always `student`: it cannot be chosen
by the browser, the API *or* the sign-up metadata (a database trigger decides it).

### A 2-minute tour

1. **Student flow:** sign in as Cynthia ▸ *Raise Ticket* ▸ open it ▸ book an appointment slot.
2. **Staff flow:** in a *second browser* (or a private window) sign in as staff ▸ *Ticket Queue* ▸ open the
   ticket ▸ change status and add a Finance Office response. Watch Cynthia's window update by itself.
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

Same API and live updates. Demo accounts are only available when running the local Supabase project.

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

**The app is laid out like the web app.** A teal top bar carries the brand and a menu button; the page sits on a white panel.
The menu is the web's side panel: it slides in from the left behind the page, the active item joins the page with the same
curved corner, and the account block (name, role, theme switch, sign out) sits at the bottom. Swipe from the left edge to open it,
or tap the page to close it. Each role sees the same menu as on the web, in the same order, plus **Account** (password, server address).

| Menu item | Student | Lecturer | Staff / admin |
|---|---|---|---|
| My Tickets / Raise Ticket | raise, list, view replies, cancel, choose an optional generated appointment slot while raising a ticket | | |
| Exam Card | apply, see why rejected, the card **with its QR code and a live units checklist** | | |
| Dashboard, Ticket Queue, Exam Applications, Fee Records | | | same as the web (manual approval, exceptions, revoke) |
| Exam Periods, Appointment Slots | | | create / activate periods; add future 30-minute slots for a chosen date/time |
| Scan Cards | | scan a card with the camera, sign your unit | same, any unit |
| My Units / Exam Units | | your units and their registers | all units; bar / allow, undo a signature, add one student |
| Account | profile, theme, password, server, sign out | same | same |

Web-only: fee **CSV import**, the unit and registration **CSV imports**, creating lecturer logins, and the **email template editor**
(a code editor that only makes sense on a computer).

**Camera:** *Scan Cards* uses the phone camera (Expo Go supports it; a standalone APK needs a fresh `eas build`, because the camera,
SVG and QR libraries are native code). **QR link:** set `EXPO_PUBLIC_WEB_URL` in `mobile/.env` to your web app's address and the QR on
a student's card holds a link to the public check page, like the printed web card; without it the QR holds just the card code, which the Finesse scanner reads fine.

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
call**. What stops them is **Row Level Security (RLS)**, set up in the initial migration:

* All tables have RLS **on**. Signed-in users may only **read** what they're entitled to (own tickets / own
  fee records / own applications; staff see all). Nobody can write through the public API: the API does all
  writes with a privileged server-side role.
* **Who booked a slot** is kept in a separate staff-only table (`slot_bookings`), so it can't leak to students
  through Realtime. The slots table itself only says *taken / free*.
* Functions that change data (`book_slot`, …) can't be called from browsers.
* Roles can't be self-assigned: a trigger creates every new profile as `student`.

**When you add a table:** enable RLS (`alter table … enable row level security;`) and add a policy,
otherwise it is readable and writable by the whole internet. Add an ordered migration under
`supabase/migrations/` and apply it with `npm run db:migrate`.

## 9. Troubleshooting

| You see | Cause / fix |
|---|---|
| Web/mobile build reports a missing/placeholder environment variable | Fill the required `VITE_*` / `EXPO_PUBLIC_*` values in the ignored `.env` file and restart the dev server or rebuild. |
| `✖ Missing SUPABASE_URL …` / `…still has the placeholder text` | `backend/.env` is missing or unfilled. See §3. |
| `✖ Cannot connect … ENOTFOUND / ENETUNREACH` | You used the *Direct connection* string (IPv6-only). Use the **Session pooler** string. |
| `password authentication failed` | Wrong DB password. Reset it under *Project Settings ▸ Database*. With the pooler the username is `postgres.<project-ref>`. |
| `Tenant or user not found` | Wrong pooler host/region, or the username isn't `postgres.<project-ref>`. Re-copy the string from *Connect*. |
| `DATABASE_URL is not a valid URL` | Special characters in the password. URL-encode them (`@` → `%40`, `#` → `%23`) or reset the password. |
| Hangs, then timeout | No internet, or the free project is **paused** (idle ~7 days). Restore it in the dashboard. |
| `✖ …Finesse tables do not exist yet` | Apply pending migrations with `npm run db:migrate` (§2 step 4). |
| `✖ Supabase rejected SUPABASE_SERVICE_ROLE_KEY` | Wrong key, or `SUPABASE_URL` belongs to a different project than the key. |
| Local demo login says "Incorrect email or password" | Demo accounts exist only in a local Supabase CLI project. To reset their local password, run `npm run db:passwords --prefix backend` with both backend URLs pointing to localhost. |
| An API call returns **503 "The database is out of date for this feature"** (older builds: **500** with `relation "unit_registrations" does not exist` in the `[api]` terminal) | A newer version added tables and migrations have not been applied with `npm run db:migrate`. |
| `✖ The database has not been updated for the latest version yet` when seeding | Run `supabase db reset` on the local Supabase CLI project, then retry `npm run db:seed`. |
| Signed in, then bounced back to login | The API rejected the session. Check `SUPABASE_URL` matches in `backend/.env` and `web/.env`; check the `[api]` terminal for errors. |
| Browser shows **"Cannot reach the Finesse API"** | The API isn't running. Check the `[api]` terminal and http://localhost:4000/api/health. |
| `EADDRINUSE :4000` or `:5173` | Port in use. Stop the other process, or set `PORT` in `backend/.env` (and the proxy target in `web/vite.config.ts`). |
| Appointment slots empty | Staff/admin must add future 30-minute slots under *Appointment Slots*; students can choose one while raising a ticket. |
| Live updates don't arrive | Check *Database ▸ Replication* lists the tables (re-run `npm run db:schema`); the 15-second polling still keeps pages fresh meanwhile. |

## 10. Tests

```bash
npm run test:unit      # backend unit tests, no database or secrets needed (Node 22+)
npm test               # backend unit tests + web unit/component tests; never contacts Supabase
npm run test:mobile    # mobile tests (no phone needed)
cd web && npm run typecheck && npm run lint
cd mobile && npx tsc --noEmit && npx expo lint
```

Remote API and RLS tests are opt-in and fail closed unless `ALLOW_INTEGRATION_TESTS=staging` is set,
`SUPABASE_URL` is exactly `https://jqmxcnilrwgirsdufzjn.supabase.co`, and `DATABASE_URL` identifies that
project's direct database host or pooler username. They never run as part of `npm test`.
To deliberately run against staging, use a separate staging env file and explicitly set the gate in that
terminal:

```powershell
Set-Location .\backend
$env:DOTENV_CONFIG_PATH = '.env.staging'
$env:ALLOW_INTEGRATION_TESTS = 'staging'
npm run test:integration

# Create or refresh the dedicated RLS test profiles. The script refuses all non-staging targets,
# checks that the required migrations exist before creating users, and prints their UUIDs.
npm run seed:rls:staging

# Copy the UUIDs printed by the seeder into this PowerShell process:
$env:RLS_TEST_STUDENT_ID = '<student-uuid>'
$env:RLS_TEST_STAFF_ID = '<staff-uuid>'
$env:RLS_TEST_LECTURER_ID = '<lecturer-uuid>'
$env:RLS_TEST_ADMIN_ID = '<admin-uuid>'
$env:RLS_TEST_INACTIVE_ID = '<inactive-user-uuid>'
npm run test:rls
```

The RLS suite uses a rolled-back transaction and checks row visibility for student, staff, lecturer, admin
and inactive identities. Do not copy real UUIDs into tracked files. The integration guard verifies the
project URL before test modules load or any connection is opened.

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
| `GET /tickets` · `POST /tickets` | student: own · staff: all | list · raise (students may reserve a future slot atomically) |
| `GET /tickets/:id` | owner or staff | one ticket (404 for other students') |
| `PATCH /tickets/:id` | student: cancel only · staff: status/priority/new response | update; responses append to history |
| `POST /tickets/:id/book` · `DELETE /tickets/:id/booking` | owner or staff | book / cancel appointment (atomic) |
| `GET /admin/staff` · `POST /admin/staff` | admin | list staff · create an account (returns a one-time temporary password; staff must change it) |
| `PATCH /admin/staff/:id` | admin | assign staff/admin/lecturer role or activate/deactivate account |
| `GET /admin/students?q=&status=&page=&pageSize=` | admin, finance staff | search paginated student account details; finance staff are read-only |
| `PATCH /admin/students/:id` | admin | activate/deactivate a student; deactivation requires an audited reason |
| `POST /admin/students/:id/password-reset` | admin | send a recovery email through backend SMTP; the one-time link is not stored in the outbox |
| `GET /slots/dates` · `GET /slots?date=` | signed in | dates with free slots · slots for a day |
| `POST /slots/generate` | staff | add a future 30-minute slot for a selected date and start time |
| `GET /fee-records/mine` | student | own fee records |
| `GET /fee-records` · `POST /fee-records/import` · `POST /fee-records/:id/exception` | staff | list · bulk upsert · grant exception |
| `GET /exam-periods` | signed in | list |
| `POST /exam-periods` · `PATCH /exam-periods/:id` | staff | create · activate/deactivate |
| `GET /applications` · `POST /applications` | student: own · staff: all | list · apply (students) |
| `POST /applications/:id/approve` | staff | manual approval with a reason |
| `POST /applications/:id/issue` | student (own, approved) | issue card (+ QR verification code) + store/send email |
| `POST /applications/:id/revoke` | staff | withdraw an issued card, with a reason |
| `POST /fee-statements?examPeriodId=` | student | **upload a fee statement** (the file is the request body: PDF, CSV/TXT or photo). Returns the decision |
| `GET /fee-statements/mine` · `GET /fee-statements` | student · staff | uploads |
| `GET /fee-statements/:id/file` | owner or staff | 5-minute signed link to the original file |
| `GET /verify/:code` | **anyone** | is this printed exam card genuine? (rate-limited; powers the QR code) |
| `GET /stats/overview` · `GET /stats/daily?days=14` | staff | dashboard numbers |
| `GET/PUT /templates` · `GET /emails` | staff | email templates · sent-email outbox |

## 12. Fee statements, exam-card verification and the dashboard

### How a student gets (or is denied) an exam card

1. **If the finance office has imported an official fee record** for the student and term (*Fee Records*), the student just presses
   *Apply*. The database decides from that record. An official record always wins.
2. **Otherwise the student uploads their fee statement** (PDF or CSV from the student portal; a photo is accepted but is read by a person).
   The API reads the text, extracts *total fees / amount paid / balance*, checks that **the statement names this student's ID** and is
   **for this academic year**, keeps the original file in a private Supabase Storage bucket, and decides:

| What the statement shows | `FEE_STATEMENT_MODE=verify` (default) | `FEE_STATEMENT_MODE=trust` |
|---|---|---|
| Balance owing / below the period's minimum % paid | **Denied** at once, with the figures in the reason | **Denied** at once |
| Cleared | **Pending**: the finance office verifies it (one click: *Verify & approve*), then the student prints the card | **Approved** at once; the card is marked *PROVISIONAL* until staff verify |
| Unreadable, figures don't add up, wrong year, no student ID | Pending: a person reviews | Pending: a person reviews |
| Belongs to a different student | Upload refused | Upload refused |

**Why `verify` is the default:** a PDF is easy to forge. Denying on a statement is safe (nobody forges a bigger debt), but *approving*
from a document the student supplied would let a doctored PDF print a real card. Switch to `trust` only if you accept that risk, or
you have no other source of fee data. Provisional cards show it on the card and on the QR verification page, and staff can **revoke** any card.

Set each exam period's **Minimum fees paid (%)** under *Exam Periods* (100 = fully cleared). It is enforced for both fee records and statements.

### The QR code on the printed card

Each issued card carries a random 12-character code and a QR code to `<PUBLIC_WEB_URL>/verify/<code>`. That page needs **no sign-in**: an
invigilator scans it and sees *Genuine*, *Provisional*, *Revoked*, *Expired* or *Not recognised*, with the student's name, ID and exam dates to compare
against their ID card. Make sure `PUBLIC_WEB_URL` is set correctly in production and that your static host serves `index.html` for
unknown paths (`web/public/_redirects` for Netlify/Cloudflare and `web/vercel.json` for Vercel are included).

### Dashboard (staff)

*Dashboard* (web, and the first tab in the mobile staff app) shows live numbers computed from real rows:

* **Active students**: students who used the web or mobile app that day (the API records one activity row per user per day).
  *Online now* = seen in the last 5 minutes.
* **Tickets**: raised / **attended** / resolved per day, **pending at the end of each day**, average first response time, oldest waiting ticket.
  *Attended* means a staff member picked the ticket up (it got an assignee) or it was resolved. A student booking an appointment does not count.
* **Exams and fees** (active exam periods): applications by status, statements awaiting verification, collection rate, cleared vs not cleared.
* Days use the campus calendar (`Africa/Nairobi`). The daily table can be exported as CSV.

Tickets and activity that happened *before* this feature was installed have no activity history (the backfill only fixes ticket timestamps).
In a local demo, `database/supabase/local/seed_demo.sql` adds two weeks of sample history so the charts aren't empty.

## 12b. Exam-hall sign-in (one scan: genuine card, the student's units, and the signature)

Replaces the paper signing sheet. A lecturer scans a student's exam-card QR code and Finesse, in one step,
(1) checks the card is genuine and current, (2) knows which units that student is registered for and allowed to sit,
and (3) marks the lecturer's unit as **sat**. The signature is a single database UPDATE, so a unit can only be signed
once: a second scan says who signed it and when. (Proven with ten simultaneous scans in `npm run test:invigilation`.)

**Who does what**
| Role | Can |
|---|---|
| Lecturer (new role) | scan cards, sign **their own** units, see those units' registers. Nothing else: no finance screens |
| Staff / admin | everything a lecturer can for **any** unit, plus set-up, bar/allow a student, undo a signature, remove a registration |
| Admin only | create lecturer logins (lecturers have no student ID, so they cannot use the student sign-up) |

**Set-up, once per exam period** (web app, *Exam Units*)
1. Create the lecturers' logins (*Set up this exam period → 3. Lecturers*, admin only). Give each a temporary password.
2. Import **student registrations**: a CSV with `student_id, unit_code` (optional `unit_name, allowed, reason`). Student IDs must match the IDs on fee records and exam cards. Units that do not exist yet are created.
3. Import **unit details** (optional but recommended): `unit_code, unit_name, exam_date, start_time, end_time, venue, lecturers` (lecturers = e-mails separated by `;`). If a unit has an `exam_date`, it can only be signed on that day.
4. Add the odd student by hand (a retake, a late registration): *Exam Units → Show register → Add a student by ID*. Or import a one-row file.
5. Check each unit has a lecturer (a unit with none shows *NO LECTURER ASSIGNED*; tick lecturers under *Lecturers*).

Both imports can be repeated safely: they never un-sign anyone, and a row with no `allowed` value never overrides a bar you set in the app. Use `allowed = no` plus a `reason` (e.g. missing CAT marks) to refuse a student for one unit.

**Getting the CSVs from Seatsync.** Seatsync knows which cohorts sit which exam, so it can produce both files:
```bash
cd Seatsync/backend
npm run export:exam-registrations                                  # lists the academic years and semesters
npm run export:exam-registrations -- "2026/2027" "Semester 1"      # writes units_*.csv and registrations_*.csv into ./exports
```
Registrations are *every ACTIVE student in the cohorts attached to each non-cancelled exam*. Seatsync has no per-student
registration (retakes, supplementary papers), so add those students with a one-row registrations CSV.

**On exam day** (web app, *Scan Cards*; works in a phone browser, which needs https or localhost for the camera)
1. Choose the unit you are invigilating (a lecturer with one unit has it chosen already).
2. Point the camera at the QR code. Green *SIGNED IN* shows the student's name and ID to compare with their ID card; red explains why not (not registered, not allowed, not your unit, card revoked/expired, wrong day, already signed).
3. Untick *Sign automatically* to see the student's units first and tap the one to sign.
4. A staff phone's own camera app also works: it opens the public check page, which shows *Sign a unit for this student* once you are signed in.

**What students see.** Under the QR code on their exam card (web and mobile app) is a checklist of their units: empty box = not yet,
ticked = sat (with the time), red cross = not allowed (with the reason). It ticks itself within a second or two of the lecturer's
scan, no refresh needed (live updates need `npm run db:schema` to have been run, which publishes the table; otherwise it refreshes every 15 seconds).

**Mistakes.** *Exam Units → Show register → Undo* (staff/admin) clears a signature; a reason is required and recorded
with every signature, reset and bar in `unit_sign_log`. The register can be exported as CSV, and students see their
units on their exam card (printed too).

**Local demo only.** `npm run db:seed` adds `lecturer@finesse.ac.ke` (password as the other demo accounts), four units and Amina's
registrations (barred from EEE202 for missing coursework). Sign in as the lecturer, choose *EEE201*, and scan Amina's card
(*Print card* on her exam card page shows the QR; or paste its code into the box).

**Not covered yet:** a scanner inside the mobile app (lecturers on the phone app are pointed to the web scanner),
and working offline in a hall with no signal (each scan needs the server).p

## 13. Going to production

The host recommendation, environment-name list, staging and smoke-test checklists, rollback plan, and first-48-hours monitoring guide are in [docs/production-launch.md](./docs/production-launch.md). The EAS APK/install guide and short privacy notice are in [mobile/BUILD_APK.md](./mobile/BUILD_APK.md).

Checklist (nothing here is optional for a real deployment):

* **Secrets:** `backend/.env` holds your Supabase **service-role key** and database password. It must never be committed, zipped, emailed or
  pasted anywhere. If it ever has been, **rotate both** in the Supabase dashboard. On your host, set variables in its dashboard instead of using a file.
* **Backend** (Render/Railway/Fly/any Docker host; `backend/Dockerfile` is included): `NODE_ENV=production`, `CORS_ORIGIN` (exact comma-separated HTTPS origins only), `PUBLIC_WEB_URL`,
  `TRUST_PROXY=1`, plus the Supabase variables. In production the server refuses to start without `CORS_ORIGIN` and `PUBLIC_WEB_URL`.
  It applies Helmet, 2 MB JSON and configured upload limits, per-route limits for signup/password changes, ticket creation/classification and uploads, and a broader fallback limiter. `TRUST_PROXY` must match the host's actual proxy-hop count. Structured request/error logs use server-generated correlation IDs and route templates; they exclude IPs, user identifiers, request data, headers, raw errors and stack traces. `/api/health` reports only API/database readiness and version. The process handles SIGTERM gracefully for long-running Node hosts.
* **Database:** link the Supabase CLI to the intended project and run `npm run db:migrate` to apply pending migrations. Never run `db:seed` against a hosted project.
  Bootstrap the first admin once with `npm run bootstrap:admin` from `backend/` after setting `BOOTSTRAP_ADMIN_NAME` and `BOOTSTRAP_ADMIN_EMAIL` plus the target Supabase environment. The script generates a one-time password and checks that all required migration versions are applied before creating or changing an Auth user. Afterward, use the admin-only `/api/admin/staff` endpoints; do not promote accounts with manual SQL.
* **Input validation:** critical backend request bodies, query values, dates, academic years, and record IDs are validated server-side. The API returns a consistent `Validation failed` response with field-level details for schema errors. Web and mobile period dates use date pickers; academic years use dropdowns.
* **Ticket classifier (F08):** rules-based classification is the default and has no external dependency. Staff see the category/priority recommendation, rationale, provider, and timestamp and can apply or override it; the classifier never changes the ticket's confirmed category/priority or resolves it. Recommendations are stored separately in `ticket_classification_recommendations`; apply the new migration before deploying this code. An optional OpenAI-compatible endpoint is enabled only when `CLASSIFIER_LLM_API_KEY`, `CLASSIFIER_LLM_URL`, and `CLASSIFIER_LLM_MODEL` are configured on the backend. The URL must be HTTPS in production; requests have a timeout and send `store: false` plus a redacted description. Only configure an endpoint whose terms/settings prohibit training on submitted content. With no key, or if classification fails/times out, ticket creation continues at the default medium priority.
* **Audit:** the new migration creates `staff_action_audit_log` (no client grants/RLS access). API transactions record staff responses, staff account creation/role/active-state changes, fee-record import batches and exceptions, and exam-card approvals/revocations. Free-form notes, response bodies and student financial details are deliberately excluded from audit metadata.
* **Storage:** the new migration creates the private `fee-statements` bucket (5 MiB) and owner/staff read plus owner-only insert policies. Only PDF, CSV/text and PNG/JPEG MIME types are allowed; the API sniffs file bytes as well as enforcing that allowlist. Past, booked, and already-started slots are hidden from non-staff direct reads; inactive periods are limited to staff/admin. Students and lecturers see only active periods. These policies replace the previous broad `USING (true)` policies.
* **Web:** `npm run build`, host `web/dist` on any static host, built with `VITE_API_URL` pointing at the API. Production source maps are disabled.
* **Mobile:** build with EAS and `EXPO_PUBLIC_API_URL=https://…`.
* **Backups:** Supabase's free tier has none and pauses idle projects. Use a paid plan with point-in-time recovery.
* **Backend email:** configure SMTP independently from Supabase Auth. For Gmail, enable 2-Step Verification and create a Google App Password; set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER` to the Gmail address, `SMTP_PASS` to the App Password, and `MAIL_FROM` to a sender using that Gmail address. Never use your normal Google password. Keep these values in backend host secrets, never in web/mobile or committed files. The shared Nodemailer transporter sends from the long-running Node API; each notification is recorded in `sent_emails` before delivery, and failed delivery remains undelivered in the outbox. Ticket response and appointment emails are dispatched asynchronously so mail failures do not block those actions. Other notification types remain out of scope.
* **Supabase Auth email:** configure custom SMTP separately in the staging Supabase dashboard: *Project Settings ▸ Authentication ▸ SMTP Settings* (menu labels may vary), enable custom SMTP, then set host `smtp.gmail.com`, port `587`, username to the Gmail address, password to the Google App Password, and sender name/email. Save and use the dashboard's test email if available. A verified sender/domain may be required; Gmail SMTP may be unsuitable for campus-scale delivery. These settings are separate from backend `SMTP_*`; do not rely on Supabase's default Auth mailer.
* **CI:** `.github/workflows/ci.yml` runs the unit tests, type checks and builds on every push. Run `npm install` in `backend`, `web` and `mobile` once and commit the updated `package-lock.json` files first (new dependencies were added).

## 14. Going beyond localhost (details)

* Host the API somewhere with HTTPS (Render, Railway, Fly…). Set its env vars there (never in the repo),
  `NODE_ENV=production`, and `CORS_ORIGIN` to the web app's URL.
* `npm run build` the web app (output in `web/dist`), host it on any static host, and build with
  `VITE_API_URL` set to the API's public URL.
* Mobile release builds need `EXPO_PUBLIC_API_URL=https://…`.
* Supabase's free tier pauses idle projects and has no automatic backups: upgrade before going live.
* **Email:** backend notifications are stored in `sent_emails` unless `SMTP_*` is configured. Supabase Auth SMTP is configured separately in the Supabase dashboard.
* Registration and password changes are rate-limited (20 attempts / 15 min per IP); sign-in attempts are
  rate-limited by Supabase.

## 15. Known limits

* **How this migration was verified.** The new database schema, security rules, triggers and every API route
  were tested against a real **PostgreSQL 16**. The 18 backend integration tests, the web tests (24) and
  the mobile tests (48) pass. Supabase's own services (Auth over HTTP, Realtime websocket, the connection
  pooler) were **not** reachable from where this was built, so Auth was exercised through a stand-in with the
  same HTTP shape. Expect to report small differences the first time you run it against your real project,
  especially **Realtime** (never run live). If live updates don't arrive, see §9; the 15-second polling covers it.
* The mobile app has not been run on a physical device or emulator, only type-checked, tested in Jest, bundled for Android, and rendered in a browser through react-native-web (so the live camera in particular is untested).
* Live updates trigger a refetch; they don't patch the screen in place. Fine at campus scale.
* **Scanned or photographed statements** can't be read automatically (no OCR): they go to a person. PDF text extraction uses `unpdf`; statement layouts vary
  between institutions, so test the parser with a real statement from yours (`backend/src/statementParser.js`, tests in `backend/test/unit`) and extend the labels if needed.
* Ticket **file attachments** and push notifications are not implemented.
* No password-reset-by-email flow yet (an admin can reset a password in *Authentication ▸ Users*;
  `change-password` works for signed-in users).
* Dates: appointment times are stored as campus wall-clock time; event times (created, issued…) are stored
  with a time zone and shown in each viewer's local time. "Today" is computed in `Africa/Nairobi`: change
  `app_today()` in `schema.sql` if the campus is elsewhere.
* The API checks each request's token with Supabase (cached for 15 s); a deleted/banned user is cut off within
  that window.

## 16. Project layout

```
supabase/
  config.toml
  migrations/     ordered schema migrations (apply with `supabase db push`)
database/supabase/
  schema.sql      legacy source snapshot for the initial migration
  local/seed_demo.sql  local-only demo data (run by `npm run db:seed`; refuses hosted projects)
  reset.sql       legacy reset SQL; use `supabase db reset` for the local CLI database
backend/src/
  server.js, app.js, config.js, db.js (Postgres), supabase.js (admin client), mailer.js
  middleware/  auth.js (verifies the Supabase token + loads the profile), errors.js
  routes/      auth, tickets, slots, fees, exam (periods + applications), templates
backend/scripts/db-setup.js      local demo seeding/password tools (non-local targets refused)
backend/test/api.test.js         18 integration tests
web/src/
  lib/         api client, supabase client, realtime hook, types, CSV parser, helpers
  components/  UI kit, Layout, route guards, setup screen
  features/    auth, tickets, exam (student + staff), slots, templates (Monaco editor)
  test/        24 tests
mobile/src/
  app/         Expo Router routes: (auth), and one (app) group with one frame and per-screen role guards
  screens/     Auth, Tickets, Exam, Staff, Admin (periods, slots), Scan, Units, Profile screens
  components/  Shell (top bar + menu), UI kit, list screen, form helpers, camera scanner, units checklist
  lib/         API client, supabase client (keychain session), realtime hook, types, formatters
  context/     auth session   theme/  dark+light tokens (same values as the web)   __tests__/  73 tests
mobile/scripts/check-api.mjs     contract check against a running backend
scripts/init-env.mjs             npm run env:init
```
