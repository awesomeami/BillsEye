import { ReceiptDocument } from '../../domain/schema';
import { getReceiptTotal } from '../../domain/reconciliation';

export interface CurrencyTotal {
  currency: string;
  totalMinor: number;
  receiptCount: number;
}

export interface FinancialExportSummary {
  confirmedReceipts: ReceiptDocument[];
  currencyTotals: CurrencyTotal[];
  unavailableTotalCount: number;
}

/** Financial reports never include pending AI drafts or combine currencies. */
export function buildFinancialExportSummary(receipts: ReceiptDocument[]): FinancialExportSummary {
  const confirmedReceipts = receipts.filter(receipt => receipt.status === 'confirmed');
  const totals = new Map<string, CurrencyTotal>();
  let unavailableTotalCount = 0;

  for (const receipt of confirmedReceipts) {
    const total = getReceiptTotal(receipt);
    if (total == null) {
      unavailableTotalCount += 1;
      continue;
    }

    const currency = receipt.currency.trim().toUpperCase() || 'PKR';
    const current = totals.get(currency) ?? { currency, totalMinor: 0, receiptCount: 0 };
    current.totalMinor += total;
    current.receiptCount += 1;
    totals.set(currency, current);
  }

  return {
    confirmedReceipts,
    currencyTotals: [...totals.values()].sort((left, right) => left.currency.localeCompare(right.currency)),
    unavailableTotalCount,
  };
}
