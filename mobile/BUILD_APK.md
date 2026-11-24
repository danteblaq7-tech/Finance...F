# Android APK (EAS internal distribution)

The current profile is for staging/internal testing. It produces a signed installable APK; it does not deploy the API or publish to Google Play.

## Before building

1. Deploy the staging API and confirm its `/api/health` URL uses HTTPS.
2. In the Expo dashboard, create an EAS project for this app. From PowerShell, run these commands from the repository root:

   ```powershell
   Set-Location .\mobile
   npx eas-cli@latest login
   npx eas-cli@latest init
   ```

   `eas init` links the project and records its EAS project ID. It has not been run as part of this task.
3. In the EAS dashboard, create these **preview** environment variables using the staging values:
   - `EXPO_PUBLIC_API_URL` — the HTTPS staging API origin
   - `EXPO_PUBLIC_SUPABASE_URL` — the staging Supabase project URL
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY` — the staging anon/publishable key

   These client values are public app configuration. Never add a service-role key, database password, or AI-provider key to EAS mobile variables. Local development continues to use the ignored `mobile/.env`.
4. Confirm the Expo app config still shows display name `Finesse`, slug `finesse-mobile`, and Android package `ke.ac.finesse.mobile`. The branded app icon and splash currently use `assets/finesse.png`; check the actual release splash on a device before distribution.

## Build and install

From `mobile/`, run:

```powershell
npx eas-cli@latest build --platform android --profile preview
```

The `preview` profile uses internal distribution, an installable APK, EAS `preview` variables, and remote auto-incremented build versions. It does not expose a LAN/HTTP endpoint: release builds reject non-HTTPS API URLs.

When EAS completes:

1. Copy the EAS build's HTTPS download link and share it only with intended testers.
2. On Android, open the link, download the APK, and open it from Downloads.
3. If prompted, allow the browser or Files app to install unknown apps, then confirm **Install**. Revoke that per-app permission afterward if desired.
4. Open Finesse, sign in with a staging account, and test ticket creation, appointments, response history, and the role-appropriate screens. Do not use production credentials in a staging APK.

## Android signing and versions

The package ID is fixed at `ke.ac.finesse.mobile`. The mobile app version is `1.1.0`; EAS uses `appVersionSource: remote` and increments build versions for the preview profile. Keep the Android signing keystore and its password in a separately secured backup, not in this repository. Losing the signing identity prevents seamless updates to installed APKs. Verify the backup can be restored before distributing broadly.

The Expo `android/` and `ios/` native directories are absent. This is the Expo managed / Continuous Native Generation workflow; EAS generates native projects from `mobile/app.json`. Do not create or edit native folders by hand.

## Privacy notice (short form)

Finesse uses account details and student identifiers to provide sign-in and campus finance services. Tickets, Finance Office responses, appointment bookings, exam-card applications, and fee-statement uploads are sent securely to the Finesse API and Supabase and are visible only to authorized roles. Sign-in tokens are stored using Android's secure storage. The camera is used only when a user chooses the exam-card scanning feature. The default ticket classifier runs as backend rules and does not send student data to an AI provider. Email notices link back to the app and do not include personal financial details. Contact the institution's Finance Office for questions or account corrections.

Publish this notice at an institution-approved HTTPS URL before any store release; no contact address or public privacy URL has been supplied yet.

## Google Play later

- Obtain the Play Console account and confirm current target-API, testing, and submission requirements before release.
- Keep the package ID unchanged; use the existing `production` profile, which builds an Android App Bundle (`.aab`) rather than the internal APK.
- Set production EAS environment values to the production HTTPS API and production Supabase URL/anon key; never reuse staging credentials.
- Back up and verify the EAS signing credentials. Prepare store listing, screenshots, app icon, support contact, privacy-policy URL, content rating, Data safety declarations, account-access instructions, and permission explanations (camera only for card scanning).
- Complete required internal/closed testing, verify the release AAB on test devices, and submit only after institutional privacy and security approval.

EAS Update is not configured. It can be considered after the EAS project is linked and runtime-version/update-channel compatibility is decided; use a new APK for native changes or API/Supabase environment changes.

The root `app.json` is a separate, minimal Expo config at repository root that lists a datetime-picker plugin. It is not the mobile app's build config. EAS commands must run from `mobile/`, where `mobile/app.json` and `mobile/eas.json` define this Android app. Leave the root config in place; do not delete it as part of mobile release setup.
