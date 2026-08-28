import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CategoryDocument, ReceiptDocument } from '../../../domain/schema';
import { getReceiptItemCategoryLabel } from '../../../domain/categories';
import {
  applyAuthoritativeReceiptSave,
  isReceiptEditorDirty,
  isReceiptRevisionConflict,
  itemMoneyKey,
  materializeReceiptMoneyText,
  receiptMoneyKey,
  shouldBlockReceiptNavigation,
} from '../editorState';

const receipt = (revision: number): ReceiptDocument => ({
  id: 'receipt-1', schemaVersion: 2, revision, status: 'pendingReview',
  createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z',
  currency: 'PKR', dateAmbiguous: false, items: [{ id: 'item-1', name: 'Milk', lineTotal: 1250, categoryId: 'groceries', userEdited: false }],
  warnings: [], ambiguousFields: [], reconciliationStatus: 'unknown', wasEditedByUser: false,
});

describe('receipt editor state', () => {
  test('uses the authoritative revision after repeated saves instead of retaining a stale version', () => {
    const first = applyAuthoritativeReceiptSave(receipt(2));
    const second = applyAuthoritativeReceiptSave(receipt(3));

    assert.strictEqual(first.receipt.revision, 2);
    assert.strictEqual(second.receipt.revision, 3);
    assert.strictEqual(second.draft.revision, 3);
    assert.strictEqual(Object.keys(second.moneyText).length, 0);
  });

  test('keeps the draft intact while category labels update independently', () => {
    const editor = applyAuthoritativeReceiptSave(receipt(1));
    const renamed: CategoryDocument[] = [{ id: 'groceries', name: 'Fresh food', isCustom: false, isActive: true, order: 0, createdAt: '2026-08-28T00:00:00.000Z' }];

    assert.strictEqual(getReceiptItemCategoryLabel(editor.draft.items![0], renamed), 'Fresh food');
    assert.deepStrictEqual(editor.draft.items, receipt(1).items);
  });

  test('retains malformed or incomplete money text until blur/save validation instead of writing null', () => {
    const invalid = materializeReceiptMoneyText(receipt(1), { [receiptMoneyKey('printedGrandTotal')]: '-' });
    const incompleteItem = materializeReceiptMoneyText(receipt(1), { [itemMoneyKey('item-1', 'lineTotal')]: '12.' });

    assert.strictEqual(invalid.draft, null);
    assert.equal(invalid.errors[receiptMoneyKey('printedGrandTotal')], 'Enter a valid amount.');
    assert.strictEqual(incompleteItem.draft, null);
  });

  test('blocks dirty router navigation but not a save or unchanged route', () => {
    assert.strictEqual(shouldBlockReceiptNavigation(true, false, '/receipts/1/review', '/reports'), true);
    assert.strictEqual(shouldBlockReceiptNavigation(true, true, '/receipts/1/review', '/reports'), false);
    assert.strictEqual(shouldBlockReceiptNavigation(true, false, '/receipts/1/review', '/receipts/1/review'), false);
    assert.strictEqual(isReceiptEditorDirty(receipt(1), receipt(1), {}), false);
    assert.strictEqual(isReceiptEditorDirty(receipt(1), receipt(1), { [receiptMoneyKey('printedTax')]: '-' }), true);
  });

  test('recognizes a recoverable optimistic-concurrency conflict', () => {
    assert.strictEqual(isReceiptRevisionConflict({ code: 'receipt-revision-conflict' }), true);
    assert.strictEqual(isReceiptRevisionConflict(new Error('network failure')), false);
  });
});
