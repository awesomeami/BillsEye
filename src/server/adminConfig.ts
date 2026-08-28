export type AdminFirebaseEnvironment = Record<string, string | undefined>;

export type FirebaseAdminConfig = {
  projectId: string;
  firestoreDatabaseId: string;
  serviceAccount: Record<string, unknown> | null;
  useApplicationDefaultCredentials: boolean;
};

type AdminConfigOptions = {
  mode: string;
  requireServiceAccount?: boolean;
};

const requiredValue = (environment: AdminFirebaseEnvironment, name: string): string => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Firebase Admin configuration is missing required field: ${name}.`);
  return value;
};

const parseServiceAccount = (value: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('invalid');
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('Firebase Admin configuration has invalid FIREBASE_SERVICE_ACCOUNT JSON.');
  }
};

export function getValidatedFirebaseAdminConfig(
  environment: AdminFirebaseEnvironment,
  { mode, requireServiceAccount = mode === 'production' }: AdminConfigOptions,
): FirebaseAdminConfig {
  const projectId = requiredValue(environment, 'FIREBASE_PROJECT_ID');
  const firestoreDatabaseId = requiredValue(environment, 'FIREBASE_DATABASE_ID');
  const configuredClientProjectId = environment.VITE_FIREBASE_PROJECT_ID?.trim();
  const configuredClientDatabaseId = environment.VITE_FIREBASE_DATABASE_ID?.trim();

  if (configuredClientProjectId && configuredClientProjectId !== projectId) {
    throw new Error('Firebase client and Admin project IDs must match.');
  }
  if (configuredClientDatabaseId && configuredClientDatabaseId !== firestoreDatabaseId) {
    throw new Error('Firebase client and Admin Firestore database IDs must match.');
  }

  const serviceAccountValue = environment.FIREBASE_SERVICE_ACCOUNT?.trim();
  const useApplicationDefaultCredentials = environment.FIREBASE_ADMIN_USE_ADC === 'true';
  if (!serviceAccountValue) {
    if (requireServiceAccount) {
      throw new Error('Firebase Admin configuration is missing required field: FIREBASE_SERVICE_ACCOUNT.');
    }
    if (!useApplicationDefaultCredentials) {
      throw new Error('Firebase Admin requires FIREBASE_SERVICE_ACCOUNT or explicit FIREBASE_ADMIN_USE_ADC in non-production modes.');
    }
    return { projectId, firestoreDatabaseId, serviceAccount: null, useApplicationDefaultCredentials: true };
  }

  const serviceAccount = parseServiceAccount(serviceAccountValue);
  if (typeof serviceAccount.project_id !== 'string' || serviceAccount.project_id.trim() !== projectId) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT project_id must match FIREBASE_PROJECT_ID.');
  }

  return { projectId, firestoreDatabaseId, serviceAccount, useApplicationDefaultCredentials: false };
}
