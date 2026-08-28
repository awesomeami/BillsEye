import bootstrapConfig from '../../../firebase-applet-config.json';

export type ClientFirebaseEnvironment = Record<string, string | undefined>;

export type FirebaseWebConfig = {
  projectId: string;
  appId: string;
  authDomain: string;
  firestoreDatabaseId: string;
  apiKey: string;
  storageBucket: string;
  messagingSenderId: string;
};

type ClientConfigOptions = {
  mode: string;
};

const REQUIRED_CLIENT_VARIABLES = [
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_DATABASE_ID',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
] as const;

const isDevelopmentOrTestMode = (mode: string): boolean => (
  mode === 'development' || mode === 'test' || mode === 'e2e'
);

const asRequiredString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const describeMissing = (environment: ClientFirebaseEnvironment): string[] => (
  REQUIRED_CLIENT_VARIABLES.filter((name) => !asRequiredString(environment[name]))
);

function validateWebConfig(config: FirebaseWebConfig): FirebaseWebConfig {
  if (!/^[a-z0-9][a-z0-9-]{4,62}$/i.test(config.projectId)) {
    throw new Error('Client Firebase configuration has an invalid VITE_FIREBASE_PROJECT_ID.');
  }
  if (!/^[^\s/]+(?:\.[^\s/]+)+$/.test(config.authDomain)) {
    throw new Error('Client Firebase configuration has an invalid VITE_FIREBASE_AUTH_DOMAIN.');
  }
  if (!/^[^\s]+$/.test(config.apiKey)) {
    throw new Error('Client Firebase configuration has an invalid VITE_FIREBASE_API_KEY.');
  }
  if (!/^[^\s]+$/.test(config.firestoreDatabaseId)) {
    throw new Error('Client Firebase configuration has an invalid VITE_FIREBASE_DATABASE_ID.');
  }
  if (!/^\d+:\d+:(?:web|android|ios):[A-Za-z0-9]+$/.test(config.appId)) {
    throw new Error('Client Firebase configuration has an invalid VITE_FIREBASE_APP_ID.');
  }
  if (!/^[a-z0-9][a-z0-9._-]*\.(?:appspot\.com|firebasestorage\.app)$/i.test(config.storageBucket)) {
    throw new Error('Client Firebase configuration has an invalid VITE_FIREBASE_STORAGE_BUCKET.');
  }
  if (!/^\d+$/.test(config.messagingSenderId)) {
    throw new Error('Client Firebase configuration has an invalid VITE_FIREBASE_MESSAGING_SENDER_ID.');
  }
  return config;
}

/**
 * The committed AI Studio bootstrap is intentionally available only to a
 * development or test caller with no explicit client Firebase values. Partial
 * values are never merged with it, preventing cross-project configurations.
 */
export function getValidatedClientFirebaseConfig(
  environment: ClientFirebaseEnvironment,
  { mode }: ClientConfigOptions,
): FirebaseWebConfig {
  const hasExplicitClientValue = REQUIRED_CLIENT_VARIABLES.some((name) => environment[name] !== undefined);
  const missing = describeMissing(environment);

  if (hasExplicitClientValue && missing.length > 0) {
    throw new Error(`Client Firebase configuration is incomplete; missing ${missing.join(', ')}.`);
  }

  if (!hasExplicitClientValue) {
    if (!isDevelopmentOrTestMode(mode)) {
      throw new Error(`Client Firebase configuration is required for ${mode} mode; missing ${REQUIRED_CLIENT_VARIABLES.join(', ')}.`);
    }

    return validateWebConfig({
      projectId: bootstrapConfig.projectId,
      appId: bootstrapConfig.appId,
      authDomain: bootstrapConfig.authDomain,
      firestoreDatabaseId: bootstrapConfig.firestoreDatabaseId,
      apiKey: bootstrapConfig.apiKey,
      storageBucket: bootstrapConfig.storageBucket,
      messagingSenderId: bootstrapConfig.messagingSenderId,
    });
  }

  return validateWebConfig({
    projectId: asRequiredString(environment.VITE_FIREBASE_PROJECT_ID)!,
    appId: asRequiredString(environment.VITE_FIREBASE_APP_ID)!,
    authDomain: asRequiredString(environment.VITE_FIREBASE_AUTH_DOMAIN)!,
    firestoreDatabaseId: asRequiredString(environment.VITE_FIREBASE_DATABASE_ID)!,
    apiKey: asRequiredString(environment.VITE_FIREBASE_API_KEY)!,
    storageBucket: asRequiredString(environment.VITE_FIREBASE_STORAGE_BUCKET)!,
    messagingSenderId: asRequiredString(environment.VITE_FIREBASE_MESSAGING_SENDER_ID)!,
  });
}
