import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Category Replacement', () => {
  it('should demonstrate replacing categories across receipt items', () => {
    const deletingCategory = 'OldCat';
    const replacementCategory = 'NewCat';

    const receipts = [
      {
        id: 'r1',
        items: [
          { name: 'A', category: 'OldCat' },
          { name: 'B', category: 'OtherCat' }
        ]
      }
    ];

    let changed = false;
    const newItems = receipts[0].items.map(item => {
      if (item.category === deletingCategory) {
        changed = true;
        return { ...item, category: replacementCategory };
      }
      return item;
    });

    assert.strictEqual(changed, true);
    assert.strictEqual(newItems[0].category, 'NewCat');
    assert.strictEqual(newItems[1].category, 'OtherCat');
  });
});
