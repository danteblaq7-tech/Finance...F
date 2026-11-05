# What changed in this production pass

Overlay these files onto your repo (everything is under `finesse/`). Existing files that changed keep their CRLF line endings.

```
CHANGED  finesse/README.md
CHANGED  finesse/backend/package.json
CHANGED  finesse/backend/scripts/db-setup.js
CHANGED  finesse/backend/src/app.js
CHANGED  finesse/backend/src/config.js
CHANGED  finesse/backend/src/middleware/auth.js
CHANGED  finesse/backend/src/middleware/errors.js
CHANGED  finesse/backend/src/routes/exam.js
CHANGED  finesse/backend/src/routes/tickets.js
CHANGED  finesse/backend/src/server.js
CHANGED  finesse/database/supabase/reset.sql
CHANGED  finesse/database/supabase/schema.sql
CHANGED  finesse/database/supabase/seed_demo.sql
CHANGED  finesse/mobile/package.json
CHANGED  finesse/mobile/src/__tests__/flows.test.tsx
CHANGED  finesse/mobile/src/app/(staff)/_layout.tsx
CHANGED  finesse/mobile/src/lib/api.ts
CHANGED  finesse/mobile/src/lib/types.ts
CHANGED  finesse/mobile/src/screens/ExamScreen.tsx
CHANGED  finesse/mobile/src/screens/StaffScreens.tsx
CHANGED  finesse/package.json
CHANGED  finesse/web/.env.example
CHANGED  finesse/web/package.json
CHANGED  finesse/web/src/App.tsx
CHANGED  finesse/web/src/components/Layout.tsx
CHANGED  finesse/web/src/features/exam/ExamCardPage.tsx
CHANGED  finesse/web/src/features/exam/StaffExamPages.tsx
CHANGED  finesse/web/src/lib/api.ts
CHANGED  finesse/web/src/lib/realtime.ts
CHANGED  finesse/web/src/lib/types.ts
CHANGED  finesse/web/src/lib/utils.ts
CHANGED  finesse/web/src/main.tsx
CHANGED  finesse/web/src/test/utils.test.ts
CHANGED  finesse/web/tsconfig.json
NEW      finesse/.github
NEW      finesse/CHANGES.md
NEW      finesse/backend/.dockerignore
NEW      finesse/backend/.env.example
NEW      finesse/backend/Dockerfile
NEW      finesse/backend/src/clearance.js
NEW      finesse/backend/src/fileType.js
NEW      finesse/backend/src/middleware/activity.js
NEW      finesse/backend/src/middleware/logging.js
NEW      finesse/backend/src/pdfText.js
NEW      finesse/backend/src/routes/statements.js
NEW      finesse/backend/src/routes/stats.js
NEW      finesse/backend/src/routes/verify.js
NEW      finesse/backend/src/services
NEW      finesse/backend/src/statementParser.js
NEW      finesse/backend/src/storage.js
NEW      finesse/backend/test/unit
NEW      finesse/mobile/src/app/(staff)/dashboard.tsx
NEW      finesse/mobile/src/screens/DashboardScreen.tsx
NEW      finesse/web/public
NEW      finesse/web/src/components/ErrorBoundary.tsx
NEW      finesse/web/src/components/charts.tsx
NEW      finesse/web/src/features/dashboard
NEW      finesse/web/src/features/verify
NEW      finesse/web/src/test/dashboard.test.ts
NEW      finesse/web/vercel.json
```

After copying: run `npm install` in backend/, web/ and mobile/ (new dependencies: unpdf, qrcode.react, expo-document-picker, expo-file-system), commit the updated package-lock.json files, then `npm run db:schema` (safe to re-run).
