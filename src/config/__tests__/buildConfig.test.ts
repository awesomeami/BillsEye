import assert from 'node:assert';
import { describe, test } from 'node:test';
import { validateViteConfiguration } from '../buildConfig';
import { getValidatedClientFirebaseConfig } from '../../services/firebase/clientConfig';
import { getValidatedFirebaseAdminConfig } from '../../server/adminConfig';
import { getReceiptExtractionModel, RECEIPT_EXTRACTION_MODEL } from '../../server/geminiConfig';

const validEnvironment = {
  VITE_FIREBASE_PROJECT_ID: 'test-project',
  VITE_FIREBASE_APP_ID: '1:123456789:web:abcdef',
  VITE_FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
  VITE_FIREBASE_DATABASE_ID: '(default)',
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_STORAGE_BUCKET: 'test-project.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789',
  FIREBASE_PROJECT_ID: 'test-project',
  FIREBASE_DATABASE_ID: '(default)',
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'test-project' }),
};

describe('configuration boundaries', () => {
  test('development and test may use only the committed web bootstrap', () => {
    for (const mode of ['development', 'test', 'e2e']) {
      const config = getValidatedClientFirebaseConfig({}, { mode });
      assert.ok(config.apiKey.length > 0);
      assert.ok(config.projectId.length > 0);
    }
  });

  test('preview and production never fall back to committed web bootstrap', () => {
    for (const mode of ['preview', 'production']) {
      assert.throws(
        () => getValidatedClientFirebaseConfig({}, { mode }),
        /Client Firebase configuration is required/,
      );
    }
  });

  test('rejects partial, blank, and whitespace client configuration without printing values', () => {
    const partial = { VITE_FIREBASE_PROJECT_ID: 'test-project' };
    assert.throws(() => getValidatedClientFirebaseConfig(partial, { mode: 'production' }), /incomplete/);

    const blank = { ...validEnvironment, VITE_FIREBASE_API_KEY: '   ' };
    assert.throws(
      () => getValidatedClientFirebaseConfig(blank, { mode: 'production' }),
      (error: unknown) => error instanceof Error
        && error.message.includes('VITE_FIREBASE_API_KEY')
        && !error.message.includes('test-api-key'),
    );

    const invalidFields = {
      VITE_FIREBASE_APP_ID: 'not-an-app-id',
      VITE_FIREBASE_AUTH_DOMAIN: 'not a domain',
      VITE_FIREBASE_DATABASE_ID: 'has whitespace',
      VITE_FIREBASE_API_KEY: 'has whitespace',
      VITE_FIREBASE_STORAGE_BUCKET: 'not-a-bucket',
      VITE_FIREBASE_MESSAGING_SENDER_ID: 'not-a-sender-id',
    } as const;
    for (const [name, value] of Object.entries(invalidFields)) {
      assert.throws(
        () => getValidatedClientFirebaseConfig({ ...validEnvironment, [name]: value }, { mode: 'production' }),
        new RegExp(name),
      );
    }
  });

  test('requires explicit Admin settings and validates service-account project alignment', () => {
    assert.throws(
      () => getValidatedFirebaseAdminConfig({}, { mode: 'production' }),
      /FIREBASE_PROJECT_ID/,
    );
    assert.throws(
      () => getValidatedFirebaseAdminConfig({
        ...validEnvironment,
        FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'other-project' }),
      }, { mode: 'production' }),
      /project_id must match/,
    );
    assert.throws(
      () => getValidatedFirebaseAdminConfig({
        ...validEnvironment,
        VITE_FIREBASE_DATABASE_ID: 'other-database',
      }, { mode: 'production' }),
      /database IDs must match/,
    );
    assert.throws(
      () => getValidatedFirebaseAdminConfig({
        FIREBASE_PROJECT_ID: 'test-project',
        FIREBASE_DATABASE_ID: '(default)',
      }, { mode: 'development' }),
      /FIREBASE_SERVICE_ACCOUNT or explicit FIREBASE_ADMIN_USE_ADC/,
    );
    assert.strictEqual(getValidatedFirebaseAdminConfig({
      FIREBASE_PROJECT_ID: 'test-project',
      FIREBASE_DATABASE_ID: '(default)',
      FIREBASE_ADMIN_USE_ADC: 'true',
    }, { mode: 'test' }).useApplicationDefaultCredentials, true);
  });

  test('production build rejects E2E mocks and mismatched Firebase projects', () => {
    assert.throws(
      () => validateViteConfiguration({ ...validEnvironment, VITE_E2E_MOCKS: 'true' }, 'production', 'build'),
      /VITE_E2E_MOCKS/,
    );
    assert.throws(
      () => validateViteConfiguration({}, 'e2e', 'build'),
      /e2e mode is reserved/,
    );
    assert.throws(
      () => validateViteConfiguration({ ...validEnvironment, FIREBASE_PROJECT_ID: 'other-project' }, 'production', 'build'),
      /project IDs must match/,
    );
  });

  test('E2E mocks are available only to the dedicated e2e development server', () => {
    assert.deepStrictEqual(
      validateViteConfiguration({ VITE_E2E_MOCKS: 'true' }, 'e2e', 'serve'),
      { useE2eMocks: true },
    );
    assert.deepStrictEqual(
      validateViteConfiguration({ VITE_E2E_MOCKS: 'true' }, 'development', 'serve'),
      { useE2eMocks: false },
    );
  });

  test('uses one fixed server-controlled receipt extraction model', () => {
    assert.strictEqual(RECEIPT_EXTRACTION_MODEL, 'gemini-3.5-flash-lite');
    assert.strictEqual(getReceiptExtractionModel(), RECEIPT_EXTRACTION_MODEL);
  });
});
