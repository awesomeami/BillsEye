# KharchaLens: Vercel & Firebase Deployment Checklist

This document verifies the readiness of KharchaLens for deployment to Vercel (Hobby Tier) and Firebase.

## 1. Automated Verification & Scans
- **`npm run verify`**: Passed. Linting, typechecking, and the full Node.js test suite ran successfully.
- **Production Build**: Passed. The Vite and esbuild steps produce optimized client SPA assets in `dist/` and a server bundle `dist/server.cjs`. Vercel will rely on `api/index.ts` to serve the API routes and natively serve the Vite static assets.
- **API Direct-Route Tests**: Passed. The API routes correctly initialize Firebase Admin (using local emulators/mocked auth during tests) and appropriately fail unauthenticated requests.
- **Mocked Authenticated API**: Passed. The test suite correctly mocks `verifyIdToken` and validates extraction proxy behavior.
- **Source/Bundle Security Scans**:
  - **Service Credentials**: No service account JSONs or `FIREBASE_SERVICE_ACCOUNT` variables are hardcoded. `.gitignore` explicitly prevents `.env` and `firebase-service-account.json` from being committed.
  - **Gemini Keys**: No Gemini keys are hardcoded in the bundle. BYOK is correctly implemented via the `x-gemini-key` header sent by the client.
  - **Real Receipts**: No real user data or receipt fixtures exist outside of the `syntheticReceipts.ts` mock data.
  - **Image Persistence**: Mocked persistence tests confirm that Base64/Blob representations of images are NOT written to `localStorage`, `IndexedDB`, or service worker caches.
  - **Firebase Storage**: The codebase does not initialize or depend on Firebase Storage. All images remain in volatile RAM.
  - **Development Logs**: Removed or wrapped inside `process.env.NODE_ENV === "development"` checks.

## 2. Vercel Configuration Readiness
- **Vercel API Setup**: Configured `api/index.ts` to expose the Express app cleanly for Vercel's Serverless Functions.
- **Routing Rules**: `vercel.json` properly routes `/api/(.*)` to the Serverless handler and fallback UI paths to `/index.html`.
- **Payload Limits**: Vercel Serverless Functions have a 4.5 MB request body limit. The Express server explicitly enforces a `4MB` Multer memory limit (`limits: { fileSize: 4 * 1024 * 1024 }`), ensuring it fails safely before hitting Vercel's infrastructure limit.
- **Environment Handling**: The backend gracefully falls back to default Firebase App initialization (useful for AI Studio) while parsing `FIREBASE_SERVICE_ACCOUNT` securely when present on Vercel.

## 3. Manual Deployment Actions

### A. Firebase Setup
1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project.
2. Enable **Firestore Database** (start in production mode) and **Authentication** (enable Google Sign-In).
3. Do **NOT** enable Firebase Storage.
4. Go to Project Settings -> Service Accounts -> Generate New Private Key. Save the JSON file securely (do not commit to Git).
5. In the Firebase CLI, deploy security rules and indexes:
   ```bash
   firebase deploy --only firestore:rules
   firebase deploy --only firestore:indexes
   ```
6. Add your Vercel deployment domain to the Authorized Domains list in Firebase Authentication settings.

### B. GitHub Sync
1. Open the AI Studio settings menu for this applet.
2. Select **Export to GitHub** or sync changes to your existing GitHub repository.

### C. Vercel Deployment
1. Log into [Vercel](https://vercel.com/) and Import the GitHub repository.
2. In the "Environment Variables" section, add:
   - All `VITE_FIREBASE_*` variables from your Firebase web config.
   - `FIREBASE_SERVICE_ACCOUNT`: Paste the ENTIRE contents of the service account JSON downloaded in step A.4.
3. Keep the default Build Command (`npm run build`) and Output Directory (`dist`).
4. Click **Deploy**.

### D. Smoke Test (Vercel)
1. Open the Vercel deployed URL.
2. Open Settings -> AI Configuration and enter a Gemini API Key (stored in local device storage).
3. Upload a sample receipt and verify that extraction completes successfully (ensuring Serverless Function execution).
4. Verify that the receipt appears in the Library, syncing correctly with Firestore.
