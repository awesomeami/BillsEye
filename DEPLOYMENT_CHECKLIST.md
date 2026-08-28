# KharchaLens deployment checklist

## Before deployment

1. Use the Node.js and npm versions pinned in `package.json`, then run `npm ci`.
2. Copy `.firebaserc.example` to a local `.firebaserc`, set it to the Firebase project being deployed, and keep it uncommitted.
3. Create production environment variables from `.env.example`. `FIREBASE_SERVICE_ACCOUNT` is private server configuration and must not use a `VITE_` prefix.
4. Enable Firestore and Google Sign-In in Firebase Authentication. Do **not** enable Firebase Storage.
5. Run `npm run verify`. The command's actual result and any lint warnings belong in `TEST_REPORT.md`; do not claim a passing result without a recorded run.

## Firebase

1. Review the strict Firestore rules and indexes in this repository.
2. Deploy them from the selected Firebase project:

   ```powershell
   npx firebase deploy --only firestore
   ```

3. Add both `http://localhost:3000` (development) and the Vercel deployment domain (production) to Firebase Authentication's Authorized domains.

`firebase.json` is intentionally project-neutral and uses the selected project's default Firestore database. A named database is an explicit deployment choice: configure the same name for the client, API, and Firebase CLI before deployment.

## Vercel

1. Import the repository, use `npm run build`, and set the output directory to `dist`.
2. Keep `vercel.json` in place: it sends `/api/*` to `api/index.ts`, sends SPA paths to `index.html`, applies the security headers, and configures a 60-second function duration.
3. Set the Firebase environment variables from `.env.example` in the appropriate Production/Preview scope.
4. Test an authenticated extraction and a client-side route after deployment.

The extractor accepts one `multipart/form-data` upload with `receiptImage` and `geminiKey` fields. It authenticates the Firebase token before parsing the upload, limits the image to 4 MiB, and stops upstream work after 55 seconds. Vercel's platform request/response payload ceiling is 4.5 MB and is not configurable in this project. The configured 60-second function duration requires a Vercel plan/runtime that permits it.

## Privacy checks

- Receipt images remain in volatile memory only; Firebase Storage is absent.
- Persistent Gemini keys use the encrypted local vault and start locked after reload. Session-only keys are not persisted. Never place a Gemini key in an environment file, commit, backup, header, log, or test output.
- The service worker precaches build assets only. API, Gemini/Google API, and object-URL traffic are network-only and never stored in its cache.
