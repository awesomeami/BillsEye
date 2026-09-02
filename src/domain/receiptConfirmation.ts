import {
  applyMerchantCategoryAlias,
  canonicalizeReceiptItemCategories,
} from './categories';
import { calculateReceiptTotals } from './reconciliation';
import { CategoryDocument, ReceiptDocument } from './schema';

export type ReceiptSaveStatus = 'confirmed' | 'pendingReview';

interface PrepareReceiptSaveOptions {
  receipt: Partial<ReceiptDocument>;
  status: ReceiptSaveStatus;
  categories: CategoryDocument[];
  discrepancyTolerance: number;
  expectedCurrency: string;
  merchantAliasCategoryId?: string | null;
  now?: () => string;
}

/**
 * Applies the financial invariants shared by every receipt save entry point.
 * Callers remain responsible only for persistence and UI state.
 */
export function prepareReceiptSave({
  receipt,
  status,
  categories,
  discrepancyTolerance,
  expectedCurrency,
  merchantAliasCategoryId,
  now = () => new Date().toISOString(),
}: PrepareReceiptSaveOptions): Partial<ReceiptDocument> {
  if (receipt.currency !== expectedCurrency) {
    throw new Error(
      `This app is configured for ${expectedCurrency} only. `
      + `Please resolve the currency to ${expectedCurrency} before saving.`,
    );
  }

  const aliasedItems = merchantAliasCategoryId
    ? applyMerchantCategoryAlias(receipt.items ?? [], merchantAliasCategoryId)
    : receipt.items ?? [];
  const items = canonicalizeReceiptItemCategories(aliasedItems, categories);
  const reconciliation = calculateReceiptTotals(items, {
    printedSubtotal: receipt.printedSubtotal,
    printedDiscount: receipt.printedDiscount,
    printedTax: receipt.printedTax,
    printedFees: receipt.printedFees,
    printedRounding: receipt.printedRounding,
    printedGrandTotal: receipt.printedGrandTotal,
  }, discrepancyTolerance);

  return {
    ...receipt,
    items,
    status,
    confirmedAt: status === 'confirmed' ? receipt.confirmedAt ?? now() : null,
    computedLineTotal: reconciliation.computedLineTotal,
    computedExpectedTotal: reconciliation.computedExpectedTotal,
    discrepancy: reconciliation.discrepancy,
    reconciliationStatus: reconciliation.reconciliationStatus,
  };
}
