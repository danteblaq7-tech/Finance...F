# Mobile app redesign: same look and logic as the web app

What changed
* **New frame, like the web:** teal top bar + a menu that slides in behind the page (the web's side panel, with the curved
  active tab, the account block, theme switch and sign out). Same menus per role as the web, same order.
* **Web look:** page headers, cards (padding, radius, shadow), type scale, buttons and badges follow the web components.
* **Screens the web had and mobile did not:** Scan Cards (camera), My Units / Exam Units (+ registers: bar, allow, undo,
  add one student), Exam Periods, Appointment Slots, and the QR code + live units checklist on the student's exam card.
* Theme switch on the sign-in screen too. Your login design is untouched.

Apply it (from your project root, the folder that contains `mobile/`)
1. Copy the `finesse/` folder from this zip over your project (replace when asked).
2. **Delete the old route folders**, or the router will see two `/tickets`, `/queue`... and refuse to start:
   * Windows PowerShell: `./cleanup-old-mobile-routes.ps1`   (or run the commands inside it)
   * macOS / Linux / Git Bash: `bash cleanup-old-mobile-routes.sh`
3. `cd mobile`, then `npm install` (adds `expo-camera`, `react-native-svg`, `react-native-qrcode-svg`).
4. `npx expo start -c` and open it in Expo Go. Expo Go supports the camera.
5. **APK:** these are native libraries, so build a NEW APK (`eas build --platform android --profile preview`). An old APK will not have the camera or QR.
6. Optional: set `EXPO_PUBLIC_WEB_URL=https://your-web-address` in `mobile/.env` so the QR on a student's card is a link to the
   public check page (otherwise it holds just the card code, which the Finesse scanner reads fine). For EAS builds add it with `eas env:create` like the other values.

Checks that were run: type-check, 73 mobile tests (cold and warm), an Android bundle build, and every screen rendered in a
phone-sized browser for each role in light and dark. NOT run: a physical phone (so the live camera is untested).
Not on mobile: the CSV imports, creating lecturer logins and the e-mail template editor (they need a computer).
