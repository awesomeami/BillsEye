import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getValidatedClientFirebaseConfig } from './clientConfig';

declare const __KHARCHALENS_VITE_FIREBASE_PROJECT_ID__: string | undefined;
declare const __KHARCHALENS_VITE_FIREBASE_APP_ID__: string | undefined;
declare const __KHARCHALENS_VITE_FIREBASE_AUTH_DOMAIN__: string | undefined;
declare const __KHARCHALENS_VITE_FIREBASE_DATABASE_ID__: string | undefined;
declare const __KHARCHALENS_VITE_FIREBASE_API_KEY__: string | undefined;
declare const __KHARCHALENS_VITE_FIREBASE_STORAGE_BUCKET__: string | undefined;
declare const __KHARCHALENS_VITE_FIREBASE_MESSAGING_SENDER_ID__: string | undefined;

const envOverrides = {
  VITE_FIREBASE_PROJECT_ID: __KHARCHALENS_VITE_FIREBASE_PROJECT_ID__,
  VITE_FIREBASE_APP_ID: __KHARCHALENS_VITE_FIREBASE_APP_ID__,
  VITE_FIREBASE_AUTH_DOMAIN: __KHARCHALENS_VITE_FIREBASE_AUTH_DOMAIN__,
  VITE_FIREBASE_DATABASE_ID: __KHARCHALENS_VITE_FIREBASE_DATABASE_ID__,
  VITE_FIREBASE_API_KEY: __KHARCHALENS_VITE_FIREBASE_API_KEY__,
  VITE_FIREBASE_STORAGE_BUCKET: __KHARCHALENS_VITE_FIREBASE_STORAGE_BUCKET__,
  VITE_FIREBASE_MESSAGING_SENDER_ID: __KHARCHALENS_VITE_FIREBASE_MESSAGING_SENDER_ID__,
};

export const firebaseConfig = getValidatedClientFirebaseConfig(envOverrides, {
  mode: import.meta.env.MODE,
});
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: 'select_account',
});
