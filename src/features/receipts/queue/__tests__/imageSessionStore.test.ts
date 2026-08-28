import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import { ImageSessionStore } from '../../../../utils/imageSessionStore';

describe('ImageSessionStore auth isolation', () => {
  afterEach(() => {
    ImageSessionStore.setActiveUser(null);
  });

  test('does not retain an old user image after a session change or sign-out', () => {
    const image = new Blob(['private receipt'], { type: 'image/jpeg' });
    ImageSessionStore.setActiveUser('user-a');
    ImageSessionStore.setForUser('user-a', 'receipt-a', image);
    assert.strictEqual(ImageSessionStore.getForUser('user-a', 'receipt-a'), image);

    ImageSessionStore.setActiveUser('user-b');
    assert.strictEqual(ImageSessionStore.getForUser('user-a', 'receipt-a'), undefined);
    ImageSessionStore.setForUser('user-a', 'late-receipt-a', image);
    assert.strictEqual(ImageSessionStore.getForUser('user-a', 'late-receipt-a'), undefined);

    ImageSessionStore.setForUser('user-b', 'receipt-b', image);
    ImageSessionStore.setActiveUser(null);
    assert.strictEqual(ImageSessionStore.getForUser('user-b', 'receipt-b'), undefined);
  });
});
