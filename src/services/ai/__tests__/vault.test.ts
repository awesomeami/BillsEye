import { describe, test } from 'node:test';
import assert from 'node:assert';
import { LocalKeyRecord, VaultInspection } from '../../../domain/aiTypes';
import {
  createLegacyReentryMarker,
  getLegacyVaultReplacement,
  getVaultStartupState,
  isLocalKeyRecord,
  planLegacyVaultReplacements,
  selectVaultEntriesForUser,
} from '../vault';

const localRecord: LocalKeyRecord = {
  slotId: 1,
  label: 'Primary',
  maskedKey: 'AIza...abcd',
  isEnabled: true,
  recordVersion: 3,
  key: 'AIzaTestOnlyKey',
};

describe('AI key browser storage contract', () => {
  test('saved browser-local keys are available immediately after startup', () => {
    const localInspection: VaultInspection = {
      localKeys: [localRecord],
      legacyKeys: [],
    };
    const legacyInspection: VaultInspection = {
      localKeys: [],
      legacyKeys: [{ slotId: 2 }],
    };

    assert.strictEqual(getVaultStartupState(localInspection), 'unlocked');
    assert.strictEqual(getVaultStartupState(legacyInspection), 'migration-required');
    assert.strictEqual(getVaultStartupState({ localKeys: [], legacyKeys: [] }), 'unconfigured');
    assert.ok(!('key' in legacyInspection.legacyKeys[0]));
  });

  test('recognizes only the versioned browser-local record shape', () => {
    assert.strictEqual(isLocalKeyRecord(localRecord), true);
    assert.strictEqual(isLocalKeyRecord({ ...localRecord, recordVersion: 2 }), false);
    assert.strictEqual(isLocalKeyRecord({ slotId: 1, key: 'legacy-value' }), false);
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
    assert.strictEqual(getLegacyVaultReplacement({ id: 'user-a_1', uid: 'user-a', recordType: 'local', ...localRecord }), null);
    assert.strictEqual(getLegacyVaultReplacement({ id: 'user-a_3', uid: 'user-a', recordType: 'encrypted', slotId: 3 }), null);
    assert.strictEqual(getLegacyVaultReplacement(marker), null);
  });

  test('device and account cleanup select every current-user vault record only', () => {
    const entries = [
      { id: 'user-a_metadata', uid: 'user-a', recordType: 'metadata' },
      { id: 'user-a_1', uid: 'user-a', recordType: 'local' },
      { id: 'user-a_2', uid: 'user-a', recordType: 'reentry-required' },
      { id: 'user-b_1', uid: 'user-b', recordType: 'local' },
    ];

    assert.deepStrictEqual(
      selectVaultEntriesForUser(entries, 'user-a').map(entry => entry.id),
      ['user-a_metadata', 'user-a_1', 'user-a_2'],
    );
  });

  test('plans plaintext removal without overwriting current or passphrase-version slots', () => {
    const entries = [
      { id: 'user-a_1', uid: 'user-a', slotId: 1, key: 'plaintext-a', recordType: 'legacy' },
      { id: 'user-b_2', uid: 'user-b', slotId: 2, key: 'plaintext-b', recordType: 'legacy' },
      { id: 'user-a_3', uid: 'user-a', recordType: 'local', ...localRecord, slotId: 3 },
      { id: 'user-b_4', uid: 'user-b', recordType: 'encrypted', slotId: 4, recordVersion: 2 },
    ];

    assert.deepStrictEqual(planLegacyVaultReplacements(entries), [
      { id: 'user-a_1', uid: 'user-a', recordType: 'reentry-required', slotId: 1, requiresReentry: true },
      { id: 'user-b_2', uid: 'user-b', recordType: 'reentry-required', slotId: 2, requiresReentry: true },
    ]);
    assert.strictEqual(isLocalKeyRecord(entries[2]), true);
  });
});
