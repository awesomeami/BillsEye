import { getApps, initializeApp, cert, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getValidatedFirebaseConfig } from '../services/firebase/coreConfig';

export function getFirebaseAdmin() {
  const config = getValidatedFirebaseConfig({
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_APP_ID: process.env.FIREBASE_APP_ID,
    FIREBASE_AUTH_DOMAIN: process.env.FIREBASE_AUTH_DOMAIN,
    FIREBASE_DATABASE_ID: process.env.FIREBASE_DATABASE_ID,
  });

  if (getApps().length === 0) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      let serviceAccount;
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      } catch (error) {
        throw new Error("Configuration Error: Failed to parse FIREBASE_SERVICE_ACCOUNT JSON. Halting initialization.");
      }
      
      if (serviceAccount.project_id && serviceAccount.project_id !== config.projectId) {
        throw new Error(`Configuration Error: Service account project_id (${serviceAccount.project_id}) does not match Firebase config projectId (${config.projectId}).`);
      }

      initializeApp({
        credential: cert(serviceAccount),
        projectId: config.projectId
      });
    } else {
      if (process.env.NODE_ENV === 'production') {
        throw new Error("Configuration Error: FIREBASE_SERVICE_ACCOUNT environment variable is missing in production.");
      }
      // Dev mode: fall back to ADC
      initializeApp({ projectId: config.projectId });
    }
  }

  const app = getApp();
  return {
    auth: getAuth(app),
    db: getFirestore(app, config.firestoreDatabaseId)
  };
}
