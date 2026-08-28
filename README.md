# KharchaLens

KharchaLens extracts structured expense data from Pakistani retail receipts and stores only the reviewed text data in Firebase Firestore.

## Privacy and storage

- Receipt images are used only in memory while an extraction is running. They are not stored in Firestore, browser storage, a service-worker cache, Firebase Storage, or any other file store.
- Firebase Storage is deliberately not used. Do not enable it for this project.
- A Gemini key is sent only in the authenticated `multipart/form-data` extraction request as the `geminiKey` field. The application does not send it in an HTTP header.
- Persistent Gemini keys are encrypted locally with AES-GCM using a passphrase-derived key. They start locked after a reload; a forgotten passphrase cannot recover them. Session-only keys are never persisted, and keys are never included in backups.

## Local setup (Windows)

### Prerequisites

Use the versions pinned in `package.json`: Node.js `24.15.0` and npm `11.12.1`. Install a current Java runtime as well if you will run the Firestore emulator tests.

### Configure Firebase

1. Create a Firebase project and enable Firestore and Google sign-in in Firebase Authentication.
2. Do **not** enable Firebase Storage.
3. Copy `.firebaserc.example` to `.firebaserc`, replace `your-firebase-project-id`, and keep that local file uncommitted.
4. Copy `.env.example` to `.env.local`. Set every `VITE_FIREBASE_*` variable together from one Firebase web app, then set the server-only `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_ID`, `FIREBASE_SERVICE_ACCOUNT`, and `GEMINI_EXTRACTION_MODEL` variables. The client and Admin project/database IDs must match. `.env.local` is ignored by Git.
5. Add `http://localhost:3000` to Firebase Authentication's Authorized domains while developing locally.

The committed Firebase web bootstrap can be used only by the explicit `development`, `test`, or `e2e` modes. Preview and production require complete environment configuration. The supplied `firebase.json` intentionally targets your project's default Firestore database; it does not embed a developer-specific project or database name. If you deliberately use a named database, set both `VITE_FIREBASE_DATABASE_ID` and `FIREBASE_DATABASE_ID` to that name and adjust your Firebase CLI configuration deliberately.

Deploy rules and indexes with the project-local Firebase CLI:

```powershell
npx firebase deploy --only firestore
```

### Install and run

```powershell
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Open `http://localhost:3000`. The development server serves both the SPA and `/api/*`, and it uses `PORT` when set (otherwise it listens on port `3000`). For example: `$env:PORT = 3100; npm run dev`.

`npm run preview` (or `npm run preview:static`) is Vite's static preview only. It does **not** run the Express API, so receipt extraction and account deletion will not work there. To smoke-test the built SPA together with the API, run:

```powershell
npm run build
$env:NODE_ENV = 'production'
npm start
```

The production Express server also honors `PORT` and returns `index.html` for client-side routes after API routes have been handled.

### Verification commands

```powershell
npm run lint
npm run typecheck
npm run test:unit
npm run test:firestore
npm run build
npm run verify
```

`npm run test:firestore` starts and stops the local Firestore emulator through the project-pinned Firebase CLI. `npm run verify` writes a factual [verification report](TEST_REPORT.md) after it runs linting, type checking, unit tests, emulator tests, and the production build. Browser tests are intentionally skipped unless you install Chromium and set `RUN_E2E=1`:

```powershell
npx playwright install chromium
$env:RUN_E2E = '1'
npm run verify
```

`npm run test:e2e` starts the dedicated `e2e` development mode. `VITE_E2E_MOCKS` is confined to that mode and causes every build to fail, preventing fake authentication or the in-memory repository from entering a deployment.

`npm run clean` removes generated `dist` directories on Windows, macOS, and Linux.

## Pull-request checks

GitHub Actions runs `npm ci`, linting, type checking, unit tests, Firestore emulator tests, the mocked browser journey, and the production build for every pull request. It uses no Firebase credentials, Gemini keys, or user data. If a check fails, open the pull request’s **Checks** tab, open the red **Verify** job, and start with the first failed command. The `verification-artifacts` download contains the generated report and Playwright diagnostics when a browser test fails.

## Vercel deployment

1. Import the repository into Vercel and retain `npm run build` as the build command with `dist` as the output directory.
2. Add the required names from `.env.example` as Vercel environment variables. Keep `FIREBASE_SERVICE_ACCOUNT` and `GEMINI_EXTRACTION_MODEL` server-only; never expose either with a `VITE_` prefix. Do not set `FIREBASE_ADMIN_USE_ADC` in production.
3. Add the deployed Vercel domain to Firebase Authentication's Authorized domains.
4. Deploy Firestore rules and indexes from the same Firebase project before allowing users to write data.

`vercel.json` configures `api/index.ts` with a 60-second maximum duration. The extraction route stops its Gemini request after 55 seconds so it can return a normal timeout response first. Vercel's request and response payload limit is 4.5 MB; the application accepts one receipt image up to 4 MiB and reserves multipart overhead below that platform limit. No setting in this repository raises Vercel's 4.5 MB platform limit.

### Extraction admission controls

Receipt extraction uses the existing Firebase Admin Firestore connection for a shared per-user admission record in the server-only `serverExtractionControls` collection. No new service, API key, index, or paid dependency is required. Browser Firestore rules deny this collection; only the Vercel server can read or write it. A record enforces a 10-request-per-minute fixed window and one active extraction lease, with a 65-second expiry so an interrupted function cannot lock a user out permanently.

## PWA behavior

The service worker precaches only built application assets. It has no cache-first runtime route. `/api` traffic, Google API traffic, and `blob:` object URLs are explicitly network-only, so receipt images, Gemini request data, and API responses are not cached.
