import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('Firestore deployment targets the named production database, not the default database', () => {
  const config = JSON.parse(readFileSync(new URL('../../../firebase.json', import.meta.url), 'utf8'));

  assert.deepEqual(config.firestore, {
    database: 'ai-studio-kharchalens-ee592688-7237-4dd5-80de-9db1abc34416',
    rules: 'firestore.rules',
    indexes: 'firestore.indexes.json',
  });
});
