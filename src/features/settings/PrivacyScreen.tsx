import React from 'react';

export function PrivacyScreen() {
  return (
    <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Privacy & Security</h2>
      
      <div className="prose prose-blue max-w-none text-gray-600">
        <p className="font-medium text-gray-900">
          KharchaLens is designed to protect your data across all interactions.
        </p>

        <h3 className="text-lg font-bold text-gray-900 mt-6">Text Data & Syncing</h3>
        <p>
          Firestore securely stores your extracted OCR text and structured receipt fields to enable cross-device syncing. This is linked strictly to your signed-in account.
        </p>
        <p>
          If you use a trusted device, you can opt-in to our Firestore offline text cache via Settings.
        </p>

        <h3 className="text-lg font-bold text-gray-900 mt-6">Image Processing & AI Extraction</h3>
        <p>
          <strong>Receipt images are not persisted by this app.</strong> They are transmitted securely over HTTPS through our Vercel Function to Google's Gemini models and are held only transiently in memory during extraction.
        </p>
        <p>
          Every extraction request explicitly sets <code>store: false</code> to ask Gemini not to retain the image. However, AI provider API terms and data usage (especially on unpaid quotas) are a separate issue and subject to change. Please review Google's <a href="https://ai.google.dev/terms" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">current API terms</a>.
        </p>

        <h3 className="text-lg font-bold text-gray-900 mt-6">API Keys</h3>
        <p>
          If you choose persistent Gemini API-key storage, the key is encrypted in this browser's IndexedDB with AES-GCM using a passphrase you provide. The passphrase stays only in memory, so keys start locked after reload and cannot be recovered if the passphrase is forgotten. Session-only keys are never persisted. Keys are never saved to Firestore or included in exports or backups; an unlocked key is sent only to the transient extraction route for each request.
        </p>
      </div>
    </div>
  );
}
