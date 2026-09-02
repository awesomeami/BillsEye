import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CategoryDocument, ReceiptDocument, ReceiptSchema } from '../schema';
import {
  applyMerchantCategoryAlias,
  buildCategoryCatalogMigration,
  canonicalizeReceiptItemCategories,
  getReceiptItemCategoryLabel,
  resolveReceiptItemCategoryId,
} from '../categories';
import { DEFAULT_CATEGORIES } from '../categoryCatalog';
import { buildCategoryReplacement, replaceCategoryInReceiptWithRetry } from '../categoryReplacement';

const groceries: CategoryDocument = {
  id: 'cat_groceries',
  name: 'Food at Home',
  legacyNames: ['Groceries'],
  isCustom: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  order: 0,
  isActive: true,
};

const eatingOut: CategoryDocument = {
  id: 'cat_eating_out',
  name: 'Eating Out',
  isCustom: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  order: 1,
  isActive: true,
};

function makeReceipt(items: ReceiptDocument['items'], revision = 1): ReceiptDocument {
  return ReceiptSchema.parse({
    id: 'receipt-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision,
    status: 'pendingReview',
    items,
  });
}

describe('category identity and compatibility', () => {
  test('resolves and migrates a legacy category name after the category is renamed', () => {
    const legacyItem = { id: 'item-1', category: 'Groceries', userEdited: false };
    assert.equal(resolveReceiptItemCategoryId(legacyItem, [groceries]), groceries.id);
    assert.equal(getReceiptItemCategoryLabel(legacyItem, [groceries]), 'Food at Home');

    const [canonical] = canonicalizeReceiptItemCategories([legacyItem], [groceries]);
    assert.equal(canonical.categoryId, groceries.id);
    assert.equal('category' in canonical, false);
  });

  test('replaces both modern IDs and legacy category names with one stable ID', () => {
    const receipt = makeReceipt([
      { id: 'modern', categoryId: groceries.id, userEdited: false },
      { id: 'legacy', category: 'Groceries', userEdited: false },
      { id: 'other', categoryId: eatingOut.id, userEdited: false },
    ]);
    const update = buildCategoryReplacement(receipt, groceries, eatingOut.id);

    assert.ok(update);
    assert.deepEqual(update.items.map(item => item.categoryId), [eatingOut.id, eatingOut.id, eatingOut.id]);
    assert.equal('category' in update.items[0], false);
    assert.equal('category' in update.items[1], false);
    assert.equal(update.items[2].userEdited, false);
  });

  test('applies a merchant alias only to items that have not been human-edited', () => {
    const aliased = applyMerchantCategoryAlias([
      { id: 'ai-item', category: 'Groceries', userEdited: false },
      { id: 'edited-item', categoryId: groceries.id, userEdited: true },
    ], eatingOut.id);

    assert.equal(aliased[0].categoryId, eatingOut.id);
    assert.equal('category' in aliased[0], false);
    assert.equal(aliased[1].categoryId, groceries.id);
  });

  test('upgrades the original catalogue without breaking historical category names', () => {
    const originalCategories: CategoryDocument[] = [
      { id: 'cat_groceries', name: 'Groceries', legacyNames: [], isCustom: false, createdAt: '2026-01-01T00:00:00.000Z', order: 0, isActive: true },
      { id: 'cat_meat', name: 'Meat', legacyNames: [], isCustom: false, createdAt: '2026-01-01T00:00:00.000Z', order: 1, isActive: true },
      { id: 'cat_fruit___vegetables', name: 'Fruit & Vegetables', legacyNames: [], isCustom: false, createdAt: '2026-01-01T00:00:00.000Z', order: 2, isActive: true },
      { id: 'cat_household', name: 'Household', legacyNames: [], isCustom: false, createdAt: '2026-01-01T00:00:00.000Z', order: 3, isActive: true },
      { id: 'cat_medicine', name: 'Medicine', legacyNames: [], isCustom: false, createdAt: '2026-01-01T00:00:00.000Z', order: 4, isActive: true },
      { id: 'cat_eating_out', name: 'Eating Out', legacyNames: [], isCustom: false, createdAt: '2026-01-01T00:00:00.000Z', order: 5, isActive: true },
      { id: 'cat_miscellaneous', name: 'Miscellaneous', legacyNames: [], isCustom: false, createdAt: '2026-01-01T00:00:00.000Z', order: 6, isActive: true },
    ];

    const migration = buildCategoryCatalogMigration(originalCategories, '2026-09-03T00:00:00.000Z');
    assert.equal(migration.updates.length, 7);
    assert.equal(migration.creates.length, 13);

    const updatedById = new Map(migration.updates.map(update => [update.id, update.data]));
    const migrated = [
      ...originalCategories.map(category => ({ ...category, ...(updatedById.get(category.id) ?? {}) })),
      ...migration.creates,
    ];
    assert.deepEqual(
      migrated.map(category => category.name).sort(),
      [...DEFAULT_CATEGORIES].sort(),
    );

    const pantry = migrated.find(category => category.id === 'cat_groceries');
    assert.ok(pantry);
    assert.equal(resolveReceiptItemCategoryId({ id: 'legacy', category: 'Groceries', userEdited: false }, migrated), pantry.id);
    assert.equal(resolveReceiptItemCategoryId({ id: 'new', category: 'Pantry & Groceries', userEdited: false }, migrated), pantry.id);
  });

  test('preserves a user-renamed default while allowing the new AI label to resolve', () => {
    const renamed: CategoryDocument = {
      ...groceries,
      legacyNames: ['Groceries'],
    };
    const migration = buildCategoryCatalogMigration([renamed], '2026-09-03T00:00:00.000Z');
    const pantryUpdate = migration.updates.find(update => update.id === renamed.id);

    assert.ok(pantryUpdate);
    assert.equal(pantryUpdate.data.name, 'Food at Home');
    assert.ok(pantryUpdate.data.legacyNames?.includes('Pantry & Groceries'));
  });

  test('retries a category replacement against the latest revision without losing another device change', async () => {
    const original = makeReceipt([{ id: 'item-1', categoryId: groceries.id, userEdited: false }], 1);
    const latest = { ...original, revision: 2, userNote: 'Edited on another device' };
    const saved: Array<{ revision: number; categoryId: string | null | undefined }> = [];
    let attempts = 0;

    const changed = await replaceCategoryInReceiptWithRetry(original, groceries, eatingOut.id, {
      loadLatest: async () => latest,
      save: async (_receiptId, update, revision) => {
        attempts += 1;
        if (attempts === 1) throw new Error('Conflict: Receipt was updated by another device.');
        saved.push({ revision, categoryId: update.items[0].categoryId });
      },
    });

    assert.equal(changed, true);
    assert.deepEqual(saved, [{ revision: 2, categoryId: eatingOut.id }]);
  });
});
