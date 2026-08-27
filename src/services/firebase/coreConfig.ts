import appletConfig from '../../../firebase-applet-config.json';

export function getValidatedFirebaseConfig(envOverrides: Record<string, string | undefined> = {}) {
  // Deterministic precedence order: Environment variables (Vercel/Node) > AI Studio generated JSON
  const projectId = envOverrides.FIREBASE_PROJECT_ID || appletConfig.projectId;
  const appId = envOverrides.FIREBASE_APP_ID || appletConfig.appId;
  const authDomain = envOverrides.FIREBASE_AUTH_DOMAIN || appletConfig.authDomain;
  const firestoreDatabaseId = envOverrides.FIREBASE_DATABASE_ID || appletConfig.firestoreDatabaseId;
  const apiKey = envOverrides.FIREBASE_API_KEY || appletConfig.apiKey;
  const storageBucket = envOverrides.FIREBASE_STORAGE_BUCKET || appletConfig.storageBucket;
  const messagingSenderId = envOverrides.FIREBASE_MESSAGING_SENDER_ID || appletConfig.messagingSenderId;

  // Validate that critical fields are nonempty and mutually consistent
  if (!projectId || !appId || !authDomain || !firestoreDatabaseId) {
    throw new Error('Firebase configuration missing required fields: projectId, appId, authDomain, or firestoreDatabaseId.');
  }

  // Basic mutual consistency checks
  if (!authDomain.includes(projectId)) {
    console.warn('Warning: authDomain does not include projectId. Please verify configuration.');
  }

  return {
    projectId,
    appId,
    authDomain,
    firestoreDatabaseId,
    apiKey,
    storageBucket,
    messagingSenderId,
  };
}