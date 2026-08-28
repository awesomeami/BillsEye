import { describe, test } from 'node:test';
import assert from 'node:assert';
import { EncryptedKeyRecord, VaultInspection } from '../../../domain/aiTypes';
import { CryptoUtils } from '../crypto';
import {
  getVaultStartupState,
  isEncryptedVaultRecord,
  selectVaultEntriesForUser,
  shouldPersistKey
} from '../vault';

const passphrase = 'a test-only vault passphrase';
const encryptedRecord: EncryptedKeyRecord = {
  slotId: 1,
  label: 'Primary',
  maskedKey: '••••••••',
  isEnabled: true,
  recordVersion: 2,
  ciphertextBase64: 'opaque-ciphertext',
  ivBase64: 'opaque-iv'
};

describe('AI key vault security contract', () => {
  test('encrypts and decrypts a value with AES-GCM, and rejects a different passphrase', async () => {
    const encrypted = await CryptoUtils.encryptSecret('test-only-secret', passphrase);

    assert.notStrictEqual(encrypted.ciphertextBase64, 'test-only-secret');
    assert.strictEqual(
      await CryptoUtils.decryptSecret(
        encrypted.ciphertextBase64,
        encrypted.ivBase64,
        encrypted.saltBase64,
        passphrase
      ),
      'test-only-secret'
    );
    await assert.rejects(() => CryptoUtils.decryptSecret(
      encrypted.ciphertextBase64,
      encrypted.ivBase64,
      encrypted.saltBase64,
      'another test-only passphrase'
    ));
  });

  test('starts encrypted vaults locked and marks legacy plaintext records for migration', () => {
    const encryptedInspection: VaultInspection = {
      metadata: { metadataVersion: 2, saltBase64: 'opaque-salt' },
      encryptedKeys: [encryptedRecord],
      legacyKeys: []
    };
    const legacyInspection: VaultInspection = {
      metadata: null,
      encryptedKeys: [],
      legacyKeys: [{ slotId: 2, maskedKey: '••••••••', isEnabled: true }]
    };

    assert.strictEqual(getVaultStartupState(encryptedInspection), 'locked');
    assert.strictEqual(getVaultStartupState(legacyInspection), 'migration-required');
    assert.strictEqual(getVaultStartupState({ metadata: null, encryptedKeys: [], legacyKeys: [] }), 'unconfigured');
    assert.ok(!('key' in legacyInspection.legacyKeys[0]));
  });

  test('never treats session-only keys as persistent records', () => {
    assert.strictEqual(shouldPersistKey(true), false);
    assert.strictEqual(shouldPersistKey(false), true);
  });

  test('recognizes only the versioned encrypted record shape', () => {
    assert.strictEqual(isEncryptedVaultRecord(encryptedRecord), true);
    assert.strictEqual(isEncryptedVaultRecord({ slotId: 1, key: 'legacy-value' }), false);
  });

  test('device and account cleanup select every current-user vault record only', () => {
    const entries = [
      { id: 'user-a_metadata', uid: 'user-a', recordType: 'metadata' },
      { id: 'user-a_1', uid: 'user-a', recordType: 'encrypted' },
      { id: 'user-a_2', uid: 'user-a', recordType: 'legacy' },
      { id: 'user-b_1', uid: 'user-b', recordType: 'encrypted' }
    ];

    assert.deepStrictEqual(
      selectVaultEntriesForUser(entries, 'user-a').map(entry => entry.id),
      ['user-a_metadata', 'user-a_1', 'user-a_2']
    );
  });
});
