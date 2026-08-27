# KharchaLens

KharchaLens is a high-precision receipt transcription and analytics web application optimized for Pakistani retail receipts. It utilizes Gemini's multimodal capabilities to extract structured data from images and securely syncs the text data across devices using Firebase Firestore.

## Purpose & Deliberately Excluded Features
KharchaLens is designed to be lightweight, secure, and privacy-first.
- **No Image Storage**: Receipt images are processed in-memory on Vercel Serverless Functions and immediately discarded. Firebase Storage is **deliberately excluded** to protect user privacy and minimize cloud storage costs.
- **No Paid AI Integration**: The app uses a Bring-Your-Own-Key (BYOK) model. Users supply their own Gemini API keys, keeping the backend entirely free to host.
- **No Background Processing**: No cron jobs, background queues, or Cloud Functions are used. Everything runs synchronously during the upload process.

## Privacy Model
- Images never touch persistent disk. They are held in volatile RAM (`ArrayBuffer`) during transit and wiped immediately after Gemini extraction.
- The `firestore.rules` security policies explicitly reject any payload attempting to write `imageBase64`, `blob`, or `file` properties to the database.
- Text data is strictly siloed per user.

## Local Setup & Firebase Project Setup

### 1. Firebase Setup
1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project.
2. Enable **Firestore Database** (start in production mode).
3. Enable **Authentication** and activate the **Google Sign-In** provider.
4. **Do NOT enable Firebase Storage.**
5. Go to Project Settings -> Service Accounts -> Generate New Private Key. Save this JSON securely.

### 2. Deploy Security Rules & Indexes
Install the Firebase CLI and initialize your project aliases to deploy the necessary rules to secure your named Firestore database.

Create a `.firebaserc` file in the project root to map your project (replace `your-project-id` with your actual project ID):
```json
{
  "projects": {
    "default": "your-project-id"
  }
}
```

Then deploy the rules and indexes:
```bash
firebase deploy --only firestore
```
*(This uses the configuration in `firebase.json` which explicitly targets the named database `ai-studio-kharchalens-ee592688-7237-4dd5-80de-9db1abc34416`)*

### 3. GitHub Sync from AI Studio
If developing within Google AI Studio:
1. Open the AI Studio settings menu for this applet.
2. Select **Export to GitHub** to sync the project to your GitHub repository.

## Vercel Deployment

1. Log into [Vercel](https://vercel.com/) and click **Add New... -> Project**.
2. Import the GitHub repository synced from AI Studio.
3. In the "Environment Variables" section, add:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_DATABASE_ID` (Use `ai-studio-kharchalens-ee592688-7237-4dd5-80de-9db1abc34416`)
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   *(Note: These client variables identify the project but are not authorization secrets).*
   
   Also add server-side explicit variables:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_APP_ID`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_DATABASE_ID`
   - `FIREBASE_SERVICE_ACCOUNT`: Paste the **entire contents** of the downloaded Service Account JSON here. Vercel handles multiline variables automatically.
4. Keep the default Build Command (`npm run build`) and Output Directory (`dist`).
5. Click **Deploy**.
6. **Important**: Copy your new `https://<your-app>.vercel.app` domain and add it to the **Authorized Domains** list in your Firebase Authentication settings.

## Usage & Workflows

### 1. Enter/Unlock Device-Local Keys
Before scanning receipts, navigate to **Settings -> AI Configuration** in the app. Enter your Gemini API Key. This key is stored securely in your device's local storage (`localStorage`) and is only sent to the server during extraction via the `x-gemini-key` header.

### 2. First Receipt & Review Workflow
1. Go to the **Import** tab and upload or take a photo of a receipt.
2. The image is sent to the Vercel API, processed by Gemini, and discarded.
3. Review the extracted data (merchant, date, items, totals).
4. Tap **Save** to sync the structured text to Firestore.

### 3. Cross-Device Text Sync & Missing Images
Because KharchaLens uses a strictly text-only persistence model, your receipts will sync across any device you log into. However, **you will not see the original receipt images on other devices (or upon refreshing the page)**. This is an intentional privacy feature.

### 4. Exports & Backups
Navigate to **Settings -> Data & Exports** to download your data as CSV or JSON.
To delete your account, use the **Delete Account** option in Settings. This securely wipes all your associated Firestore records.

## Limitations & Free-Tier Constraints
- **Vercel Hobby Tier**: Serverless functions have a 10-second timeout and a 4.5 MB request body limit. Keep receipt images under 4 MB (the client automatically compresses them).
- **Firebase Free Tier**: Firestore allows 50K reads and 20K writes per day, which is more than enough for personal use.
- **Gemini API**: Depending on your Gemini API tier, you may be subject to Rate Limits (RPM/TPM).
