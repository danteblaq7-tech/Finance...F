# Building the Finesse Android APK

The phone cannot reach `localhost`, and release apps refuse plain `http://`. So the APK needs the Finesse API on a public **https** address.

## 1. Put the API on https (pick one)
**A. Deploy it (permanent)** - Render/Railway/Fly. Root directory `backend`, Dockerfile or `npm ci` + `node src/server.js`.
Env vars: everything in backend/.env.example, plus `NODE_ENV=production`, `CORS_ORIGIN=<your web url>`, `PUBLIC_WEB_URL=<your web url>`.
Check: `https://<your-api>/api/health`.

**B. Tunnel your laptop (temporary, for demos)** - keep `npm run dev` running, then `cloudflared tunnel --url http://localhost:4000`
(or `ngrok http 4000`). It prints an https address. Works only while your laptop and the tunnel are on.

Test it from the repo root: `npm run check:api -- https://<your-api>`

## 2. Run locally in Expo Go
```
cd mobile && npm install && npx expo start -c
```
Set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_API_URL` in the git-ignored `mobile/.env` first. For a physical phone, set the API URL to the computer's LAN address, such as `http://<LAN-IP>:4000`; the phone and computer must be on the same network. Simulator/emulator users should set the reachable API URL for their setup explicitly.

## 3. Build the APK (Expo cloud build)
```
npm install -g eas-cli
cd mobile
eas login
eas init
```
`mobile/.env` is git-ignored, so the cloud build never sees it. Define all three required public values in the EAS `preview` environment. Recommended: use EAS environment variables (the Supabase URL, anon/publishable key and API URL are public client configuration, not secrets):
```
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://xxxx.supabase.co --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_API_URL --value https://<your-api> --visibility plaintext
```
Alternatively, non-secret values can go in the selected build profile's `env` object in `eas.json`:
```json
"preview": {
  "env": {
    "EXPO_PUBLIC_SUPABASE_URL": "https://<project-ref>.supabase.co",
    "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<anon-or-publishable-key>",
    "EXPO_PUBLIC_API_URL": "https://<api-host>"
  }
}
```
Do not put a service-role key, secret key, database password or AI-provider key in `eas.json` or any `EXPO_PUBLIC_*` variable. If a flag differs on your eas-cli version: `eas env:create --help`.
```
eas build --platform android --profile preview
```
When it finishes, open the link it prints on the phone and install the APK (allow "install unknown apps").

## 4. Test checklist on the phone
Sign in (student + staff) - raise a ticket - see it appear on the web app within seconds - change its status on web and watch the phone update -
apply for an exam card - upload a statement - close and reopen the app (should stay signed in) - toggle theme - airplane mode (should show a clear error).
Crash? Plug in USB and run `adb logcat *:E`.

## Notes
* API and Supabase URL changes require a new build because the values are bundled into the app.
* Keep a secure backup of the Android signing keystore and its password (use `eas credentials` to view/manage credentials). Store the backup separately from the repository. Losing it prevents updates to the same installed Android app.
* Play Store needs the `production` profile (an .aab) and a Google Play developer account.
