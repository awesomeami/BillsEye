import { ReceiptDocument } from '../../domain/schema';

/**
 * Firestore cannot order by an optional field without excluding documents that
 * omit it, so confirmed receipts are ordered after hydration instead.
 */
export function sortReceiptsByTransactionDateDescending(
  receipts: readonly ReceiptDocument[],
): ReceiptDocument[] {
  return receipts
    .map((receipt, originalIndex) => ({ receipt, originalIndex }))
    .sort((left, right) => {
      const leftDate = left.receipt.transactionDate;
      const rightDate = right.receipt.transactionDate;
      if (leftDate && rightDate) {
        const dateComparison = rightDate.localeCompare(leftDate);
        if (dateComparison !== 0) return dateComparison;
      } else if (leftDate) {
        return -1;
      } else if (rightDate) {
        return 1;
      }

      const createdComparison = right.receipt.createdAt.localeCompare(left.receipt.createdAt);
      if (createdComparison !== 0) return createdComparison;
      return left.originalIndex - right.originalIndex;
    })
    .map(entry => entry.receipt);
}
