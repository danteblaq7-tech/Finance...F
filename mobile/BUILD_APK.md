# Building the Finesse Android APK

The phone cannot reach `localhost`, and release apps refuse plain `http://`. So the APK needs the Finesse API on a public **https** address.

## 1. Put the API on https (pick one)
**A. Deploy it (permanent)** - Render/Railway/Fly. Root directory `backend`, Dockerfile or `npm ci` + `node src/server.js`.
Env vars: everything in backend/.env.example, plus `NODE_ENV=production`, `CORS_ORIGIN=<your web url>`, `PUBLIC_WEB_URL=<your web url>`.
Check: `https://<your-api>/api/health`.

**B. Tunnel your laptop (temporary, for demos)** - keep `npm run dev` running, then `cloudflared tunnel --url http://localhost:4000`
(or `ngrok http 4000`). It prints an https address. Works only while your laptop and the tunnel are on.

Test it from the repo root: `npm run check:api -- https://<your-api>`

## 2. Try it in Expo Go first (cheap, catches problems before a 15-minute build)
```
cd mobile && npm install && npx expo start -c
```
Phone on the same Wi-Fi, scan the QR in Expo Go. Sign in with a demo account.

## 3. Build the APK (Expo cloud build)
```
npm install -g eas-cli
cd mobile
eas login
eas init
```
`mobile/.env` is git-ignored, so the cloud build never sees it. Store the values with EAS instead (one time):
```
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://xxxx.supabase.co --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_API_URL --value https://<your-api> --visibility plaintext
```
(Never use the service_role key here. If a flag differs on your eas-cli version: `eas env:create --help`.)
```
eas build --platform android --profile preview
```
When it finishes, open the link it prints on the phone and install the APK (allow "install unknown apps").

## 4. Test checklist on the phone
Sign in (student + staff) - raise a ticket - see it appear on the web app within seconds - change its status on web and watch the phone update -
apply for an exam card - upload a statement - close and reopen the app (should stay signed in) - toggle theme - airplane mode (should show a clear error).
Crash? Plug in USB and run `adb logcat *:E`.

## Notes
* Changing the API address later does not need a rebuild: sign-in screen > Server > change (https addresses only in a release build).
* Keep the signing key EAS creates (`eas credentials`). Updates must be signed with the same key.
* Play Store needs the `production` profile (an .aab) and a Google Play developer account.
