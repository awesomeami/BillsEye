import { normalizeMerchantName } from './categories';
import { getReceiptTotal } from './reconciliation';
import { ReceiptDocument } from './schema';

export interface DuplicateReceiptFingerprint {
  merchant: string;
  transactionDate: string;
  total: number;
}

export function getDuplicateReceiptFingerprint(
  receipt: ReceiptDocument,
): DuplicateReceiptFingerprint | null {
  const merchant = normalizeMerchantName(
    receipt.merchantNormalized || receipt.merchantRaw || '',
  );
  const total = getReceiptTotal(receipt);
  if (!merchant || !receipt.transactionDate || total == null) return null;

  return { merchant, transactionDate: receipt.transactionDate, total };
}

export function receiptMatchesDuplicateFingerprint(
  receipt: ReceiptDocument,
  fingerprint: DuplicateReceiptFingerprint,
): boolean {
  const candidate = getDuplicateReceiptFingerprint(receipt);
  return candidate !== null
    && candidate.merchant === normalizeMerchantName(fingerprint.merchant)
    && candidate.transactionDate === fingerprint.transactionDate
    && candidate.total === fingerprint.total;
}
