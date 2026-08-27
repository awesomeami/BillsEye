import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache } from 'firebase/firestore';

// Platform-injected Firebase configuration
import { getValidatedFirebaseConfig } from './coreConfig';

const envOverrides = {
  FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
  FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  FIREBASE_DATABASE_ID: import.meta.env.VITE_FIREBASE_DATABASE_ID,
  FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

export const firebaseConfig = getValidatedFirebaseConfig(envOverrides);
export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// Request minimal scopes
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

export const isTrustedDevice = localStorage.getItem('kharchalens_trusted_device') === 'true';

export const db = initializeFirestore(app, {
  localCache: isTrustedDevice 
    ? persistentLocalCache({ tabManager: persistentMultipleTabManager() }) 
    : memoryLocalCache()
}, firebaseConfig.firestoreDatabaseId);


