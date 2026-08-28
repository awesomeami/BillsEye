import { CategoryDocument, ReceiptDocument } from './schema';
import { replaceReceiptItemCategory } from './categories';

export function isReceiptRevisionConflict(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Conflict:');
}

export function buildCategoryReplacement(
  receipt: ReceiptDocument,
  oldCategory: CategoryDocument,
  replacementCategoryId: string,
): Pick<ReceiptDocument, 'items' | 'wasEditedByUser'> | null {
  const items = receipt.items.map(item => replaceReceiptItemCategory(item, oldCategory, replacementCategoryId));
  const changed = items.some((item, index) => item !== receipt.items[index]);
  return changed ? { items, wasEditedByUser: true } : null;
}

interface RevisionSafeReplacementAdapter {
  loadLatest: (receiptId: string) => Promise<ReceiptDocument | null>;
  save: (
    receiptId: string,
    update: Pick<ReceiptDocument, 'items' | 'wasEditedByUser'>,
    revision: number,
  ) => Promise<void>;
}

/**
 * A category replacement can span many receipts, so it cannot be one Firestore
 * transaction. Each receipt write is still revision-checked; on one stale
 * revision we reload and apply the same deterministic change to the latest
 * document rather than overwrite another device's edit.
 */
export async function replaceCategoryInReceiptWithRetry(
  receipt: ReceiptDocument,
  oldCategory: CategoryDocument,
  replacementCategoryId: string,
  adapter: RevisionSafeReplacementAdapter,
): Promise<boolean> {
  let current = receipt;
  let update = buildCategoryReplacement(current, oldCategory, replacementCategoryId);
  if (!update) return false;

  try {
    await adapter.save(current.id, update, current.revision);
    return true;
  } catch (error) {
    if (!isReceiptRevisionConflict(error)) throw error;
  }

  const latest = await adapter.loadLatest(receipt.id);
  if (!latest) {
    throw new Error('Receipt no longer exists while replacing its category.');
  }
  current = latest;
  update = buildCategoryReplacement(current, oldCategory, replacementCategoryId);
  if (!update) return false;
  await adapter.save(current.id, update, current.revision);
  return true;
}
