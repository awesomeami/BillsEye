import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RestoreInterruptedError,
  RestoreProgress,
  runRestoreTasks,
} from '../restoreProgress';

test('reports the exact partial restore progress when a record fails', async () => {
  const completed: string[] = [];
  let latest: RestoreProgress | null = null;

  await assert.rejects(
    runRestoreTasks([
      { section: 'receipts', run: async () => { completed.push('receipt'); } },
      { section: 'categories', run: async () => { throw new Error('offline'); } },
      { section: 'aliases', run: async () => { completed.push('alias'); } },
    ], progress => { latest = progress; }),
    (error: unknown) => {
      assert.ok(error instanceof RestoreInterruptedError);
      assert.strictEqual(error.progress.completed, 1);
      assert.strictEqual(error.progress.total, 3);
      assert.strictEqual(error.progress.currentSection, 'categories');
      assert.deepStrictEqual(error.progress.completedBySection, {
        receipts: 1,
        categories: 0,
        aliases: 0,
        settings: 0,
        profile: 0,
      });
      return true;
    },
  );

  assert.deepStrictEqual(completed, ['receipt']);
  assert.ok(latest);
});
