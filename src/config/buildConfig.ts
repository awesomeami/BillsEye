import { getValidatedClientFirebaseConfig, type ClientFirebaseEnvironment } from '../services/firebase/clientConfig';
import { getValidatedFirebaseAdminConfig, type AdminFirebaseEnvironment } from '../server/adminConfig';
import { getReceiptExtractionModel } from '../server/geminiConfig';

type BuildCommand = 'serve' | 'build';

export type ViteConfigurationResult = {
  useE2eMocks: boolean;
};

/** Shared Vite build gate. It is pure so every mode can be regression-tested. */
export function validateViteConfiguration(
  environment: ClientFirebaseEnvironment & AdminFirebaseEnvironment,
  mode: string,
  command: BuildCommand,
): ViteConfigurationResult {
  const useE2eMocks = mode === 'e2e' && environment.VITE_E2E_MOCKS === 'true';
  if (command === 'build' && mode === 'e2e') {
    throw new Error('The e2e mode is reserved for the dedicated development server and cannot be built.');
  }
  if (command === 'build' && environment.VITE_E2E_MOCKS === 'true') {
    throw new Error('VITE_E2E_MOCKS is permitted only for the dedicated e2e development server, never for a build.');
  }

  if (command === 'build') {
    // A build is a deployable artifact regardless of its caller-supplied
    // mode. Never let a test/dev bootstrap enter an output bundle.
    const clientConfig = getValidatedClientFirebaseConfig(environment, { mode: 'production' });
    const adminConfig = getValidatedFirebaseAdminConfig(environment, {
      mode: 'production',
      requireServiceAccount: true,
    });
    if (clientConfig.projectId !== adminConfig.projectId) {
      throw new Error('Firebase client and Admin project IDs must match.');
    }
    if (clientConfig.firestoreDatabaseId !== adminConfig.firestoreDatabaseId) {
      throw new Error('Firebase client and Admin Firestore database IDs must match.');
    }
    getReceiptExtractionModel();
  }

  return { useE2eMocks };
}
