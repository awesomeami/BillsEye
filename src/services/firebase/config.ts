import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache } from 'firebase/firestore';

import { getValidatedClientFirebaseConfig } from './clientConfig';
import { getTrustedDevicePreference } from './offlineStorage';

const envOverrides = {
  FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
  FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  FIREBASE_DATABASE_ID: import.meta.env.VITE_FIREBASE_DATABASE_ID,
  FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

export const firebaseConfig = getValidatedClientFirebaseConfig(envOverrides, {
  mode: import.meta.env.MODE,
});
export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// Request minimal scopes
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// This preference is read exactly once when Firestore is initialized. Switching
// persistence mode therefore requires terminating the current client and a
// reload; Settings makes that explicit before saving a new preference.
export const isTrustedDevice = getTrustedDevicePreference();

export const db = initializeFirestore(app, {
  localCache: isTrustedDevice 
    ? persistentLocalCache({ tabManager: persistentMultipleTabManager() }) 
    : memoryLocalCache()
}, firebaseConfig.firestoreDatabaseId);


