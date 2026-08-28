import { describe, test } from 'node:test';
import assert from 'node:assert';
import { EncryptedKeyRecord, VaultInspection } from '../../../domain/aiTypes';
import { CryptoUtils } from '../crypto';
import {
  getVaultStartupState,
  createLegacyReentryMarker,
  getLegacyVaultReplacement,
  planLegacyVaultReplacements,
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
      legacyKeys: [{ slotId: 2 }]
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

  test('replaces legacy plaintext with minimal keyless re-entry metadata', () => {
    const legacyEntry = {
      id: 'user-a_2',
      uid: 'user-a',
      recordType: 'legacy',
      slotId: 2,
      key: 'plaintext-secret',
      label: 'Private label',
      maskedKey: 'secret-tail',
      isEnabled: true,
    };
    const marker = createLegacyReentryMarker(legacyEntry);

    assert.deepStrictEqual(marker, {
      id: 'user-a_2',
      uid: 'user-a',
      recordType: 'reentry-required',
      slotId: 2,
      requiresReentry: true,
    });
    assert.doesNotMatch(JSON.stringify(marker), /plaintext-secret|Private label|secret-tail/);
    assert.deepStrictEqual(getLegacyVaultReplacement(legacyEntry), marker);
    assert.strictEqual(getLegacyVaultReplacement({ id: 'user-a_1', uid: 'user-a', ...encryptedRecord }), null);
    assert.strictEqual(getLegacyVaultReplacement(marker), null);
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

  test('plans plaintext removal for every UID while preserving encrypted AES-GCM rows', () => {
    const entries = [
      { id: 'user-a_1', uid: 'user-a', slotId: 1, key: 'plaintext-a', recordType: 'legacy' },
      { id: 'user-b_2', uid: 'user-b', slotId: 2, key: 'plaintext-b', recordType: 'legacy' },
      { id: 'user-a_3', uid: 'user-a', recordType: 'encrypted', ...encryptedRecord, slotId: 3 },
      { id: 'user-b_4', uid: 'user-b', recordType: 'encrypted', ...encryptedRecord, slotId: 4 },
    ];

    assert.deepStrictEqual(planLegacyVaultReplacements(entries), [
      { id: 'user-a_1', uid: 'user-a', recordType: 'reentry-required', slotId: 1, requiresReentry: true },
      { id: 'user-b_2', uid: 'user-b', recordType: 'reentry-required', slotId: 2, requiresReentry: true },
    ]);
    assert.strictEqual(isEncryptedVaultRecord(entries[2]), true);
    assert.strictEqual(isEncryptedVaultRecord(entries[3]), true);
  });
});
