import { getApps, initializeApp, cert, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getValidatedFirebaseAdminConfig } from './adminConfig.js';

const ADMIN_APP_NAME = 'kharchalens-server';

export function getFirebaseAdmin() {
  const config = getValidatedFirebaseAdminConfig(process.env, {
    mode: process.env.NODE_ENV ?? 'development',
  });

  const existingApp = getApps().find((app) => app.name === ADMIN_APP_NAME);
  if (!existingApp) {
    if (config.serviceAccount) {
      initializeApp({
        credential: cert(config.serviceAccount),
        projectId: config.projectId
      }, ADMIN_APP_NAME);
    } else {
      // ADC is permitted only after explicit non-production configuration.
      initializeApp({ projectId: config.projectId }, ADMIN_APP_NAME);
    }
  }

  const app = getApp(ADMIN_APP_NAME);
  return {
    auth: getAuth(app),
    db: getFirestore(app, config.firestoreDatabaseId)
  };
}
