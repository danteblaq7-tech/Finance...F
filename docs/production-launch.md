# Finesse staging and launch runbook

No hosting, Supabase, or EAS deployment was performed. Use separate staging and production Supabase projects, and populate secrets only in the corresponding host dashboards.

## Recommended hosting

- **API: Render Web Service, paid Starter plan.** Use the root `render.yaml` Blueprint. It runs the existing Node/Express server continuously, uses the platform-provided `PORT`, exposes `/api/health`, and sets `TRUST_PROXY=1`. Render Free web services sleep after 15 minutes without traffic and take about a minute to wake; Render explicitly says Free instances are not for production, so use Free only for a temporary staging trial. Confirm current paid pricing before signup.
- **Web: Cloudflare Pages Free.** Build the static React SPA with `npm ci` and `npm run build`; output directory `dist`, root directory `web`. Configure the three `VITE_*` variables in the Pages build settings. Pages serves SPA routes from the root when no top-level `404.html` is present. Static Pages has no sleeping application process.
- Use the platform HTTPS subdomains initially. The API accepts only exact HTTPS `CORS_ORIGIN` origins in production; adding a custom domain later is an environment change, not a code change.

Sources: [Render free-instance limits](https://render.com/docs/free), [Render Blueprint specification](https://render.com/docs/blueprint-spec), and [Cloudflare Pages SPA behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/).

## Environment variable names

The committed `render.yaml` includes only variable names and non-secret runtime settings. Fill secret values in Render's environment dashboard; never commit them or place backend-only keys in a client.

Backend required: `NODE_ENV`, `PORT` (provided by host), `TRUST_PROXY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `CORS_ORIGIN`, `PUBLIC_WEB_URL`.

Backend optional: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `STUDENT_ID_PATTERN`, `FEE_STATEMENT_MODE`, `MAX_STATEMENT_MB`, `CLASSIFIER_LLM_URL`, `CLASSIFIER_LLM_MODEL`, `CLASSIFIER_LLM_API_KEY`, `CLASSIFIER_TIMEOUT_MS`.

Web build: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

Mobile EAS `preview` environment: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The API URL must be HTTPS. Mobile clients may contain only the Supabase anon/publishable key and API URL, never a service-role or AI-provider key.

## Staging deployment checklist

1. Confirm the staging Supabase project and plan, backup/restore capability, Auth settings, and custom SMTP configuration. Do not use the development project or production data.
2. Verify staging-only environment values and the staging guards. Check that `SUPABASE_URL`, the pooler `DATABASE_URL`, and keys all belong to the same staging project.
3. Review the pending migration list, take the plan-supported backup/snapshot, then apply migrations using the Supabase CLI. Do not execute `seed_demo.sql` on any hosted project.
4. Run the staging-only RLS suite with its explicit guard and prepared test profiles. Check inactive-account access and direct slot visibility.
5. Create the Render API and Cloudflare Pages site from the configuration above. Set `NODE_ENV=production`, `TRUST_PROXY=1`, exact `CORS_ORIGIN`, and `PUBLIC_WEB_URL`; add remaining backend secrets in the host dashboard.
6. Configure `VITE_*` values for the staging API and staging Supabase project. Build and verify the site, API health endpoint, reset-email redirect, fee-statement upload, and QR verification route.
7. Configure the EAS `preview` environment with the HTTPS staging API URL and staging Supabase URL/anon key, then build an internal APK. Install and smoke-test before sharing its HTTPS EAS download link.
8. Promote only after sign-off. Production uses a separate Supabase project and environment variables; never copy staging service-role keys, database passwords, or user data into production.

## Smoke-test checklist

Run on the web app and on a physical Android device with the APK.

**Student**
- Sign in, sign out, and restore a session after app restart; inactive accounts are rejected.
- Raise a ticket with and without an optional in-person appointment. Confirm only future staff-generated slots can be selected and the appointment appears in ticket history.
- Read timestamped Finance Office response history; cancel a ticket and verify it cannot receive further activity.
- Change/cancel an appointment and confirm its email contains no financial information.
- Upload an allowed fee statement; verify private storage access and rejection of disallowed MIME types.
- Apply for an exam card, verify status/QR page, and load the student's units checklist.

**Finance staff/admin**
- Sign in, open the queue, classify a ticket, accept/override the suggestion, respond, and verify chronological response history and email.
- Generate a future slot for a chosen date/time; reject past, duplicate, and overlapping slots. Confirm the slot becomes available to students.
- Confirm/change/cancel an appointment and verify notification/outbox behavior.
- Admin: create/manage staff, search student accounts, deactivate/reactivate, send password reset, and confirm audit entries.
- Exercise fee exceptions, exam-card decisions, and the admin-only controls; verify staff/student/lecturer access boundaries.

Also check `/api/health`, HTTPS and CORS from the deployed site, logs contain no tokens/request bodies/PII, and the staging RLS suite passes.

## Rollback plan

- **Web:** restore the previous successful Cloudflare Pages deployment.
- **API:** roll back to the previous successful Render deployment. Roll API back before clients only if the previous API is compatible; the optional `slotId` ticket field requires deploying the API before the new web client/APK.
- **Mobile:** stop distributing the new APK and provide the previous signed APK. Preserve the EAS Android keystore and its password in a separate secure backup; Android upgrades require the same signing identity.
- **Database:** do not drop or reverse an applied migration during an incident. Keep additive migrations in place, restore from the confirmed Supabase backup only under the recovery plan, or deploy a forward-fix. Recheck API/RLS behavior before reopening traffic.
- Pause account creation or ticket submissions with host-level routing/maintenance controls if a safe application rollback is unavailable. Keep a named operator responsible for each action.

## First 48 hours

- Watch Render health checks, restarts, CPU/memory, response latency, 4xx/5xx rates, database connection failures, rate-limit spikes, and sanitized structured error events.
- Check Supabase Auth errors, database availability/connection usage, slow queries, storage failures, RLS denials, and backup status.
- Verify ticket/appointment/response counts against expected operations; inspect notification delivery and failed outbox rows without exposing message contents or addresses unnecessarily.
- Monitor Cloudflare Pages deploy status and client-side error reports; manually verify web and APK sign-in, ticket creation, appointments, and exam-card paths after each release.
- Keep rollback artifacts, operator contacts, and an incident log available. Do not enable verbose body/header logging to debug production problems.

## Readiness still required

- Confirm staging/production origins, host accounts, Supabase backup/restore capability for the selected plan, SMTP credentials and sender verification, and the final privacy-policy URL.
- Add the EAS project ID through `eas init` and populate EAS `preview` variables before requesting an APK build. No project ID, endpoint, credential, or deployment is assumed here.
