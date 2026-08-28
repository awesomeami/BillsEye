import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import { ImageSessionStore } from '../../../../utils/imageSessionStore';

describe('ImageSessionStore auth isolation', () => {
  afterEach(() => {
    ImageSessionStore.clear();
    ImageSessionStore.setActiveUser(null);
  });

  test('does not retain an old user image after a session change or sign-out', () => {
    const image = new Blob(['private receipt'], { type: 'image/jpeg' });
    ImageSessionStore.setActiveUser('user-a');
    ImageSessionStore.set('receipt-a', image);
    assert.strictEqual(ImageSessionStore.get('receipt-a'), image);

    ImageSessionStore.setActiveUser('user-b');
    assert.strictEqual(ImageSessionStore.get('receipt-a'), undefined);

    ImageSessionStore.set('receipt-b', image);
    ImageSessionStore.setActiveUser(null);
    assert.strictEqual(ImageSessionStore.get('receipt-b'), undefined);
  });
});
