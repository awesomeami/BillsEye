import { ReceiptDocument } from '../../../domain/schema';

export interface FilterState {
  searchQuery: string;
  dateStart: string | null;
  dateEnd: string | null;
  merchant: string | null;
  category: string | null;
  item: string | null;
  paymentMethod: string | null;
  amountMin: number | null;
  amountMax: number | null;
  hasWarning: boolean | null;
}

export type SortField = 'date' | 'total' | 'merchant';
export type SortOrder = 'asc' | 'desc';

export interface SortState {
  field: SortField;
  order: SortOrder;
}

export function filterAndSortReceipts(receipts: ReceiptDocument[], filters: FilterState, sort: SortState): ReceiptDocument[] {
  let result = receipts;

  if (filters.searchQuery) {
    const q = filters.searchQuery.toLowerCase();
    result = result.filter(r => {
      if (r.merchantNormalized?.toLowerCase().includes(q) || r.merchantRaw?.toLowerCase().includes(q)) return true;
      if (r.receiptNumber?.toLowerCase().includes(q)) return true;
      if (r.userNote?.toLowerCase().includes(q)) return true;
      if (r.rawOcrText?.toLowerCase().includes(q)) return true;
      if (r.items.some(item => item.name?.toLowerCase().includes(q) || item.rawLineText?.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  if (filters.dateStart) {
    result = result.filter(r => r.transactionDate && r.transactionDate >= filters.dateStart!);
  }
  if (filters.dateEnd) {
    result = result.filter(r => r.transactionDate && r.transactionDate <= filters.dateEnd!);
  }
  if (filters.merchant) {
    result = result.filter(r => r.merchantNormalized === filters.merchant);
  }
  if (filters.category) {
    result = result.filter(receipt => receipt.items.some(item =>
      item.categoryId === filters.category || (!item.categoryId && item.category === filters.category),
    ));
  }
  if (filters.item) {
    result = result.filter(r => r.items.some(item => item.name === filters.item));
  }
  if (filters.paymentMethod) {
    result = result.filter(r => r.paymentMethod === filters.paymentMethod);
  }
  if (filters.amountMin !== null) {
    result = result.filter(r => (r.printedGrandTotal ?? 0) >= filters.amountMin!);
  }
  if (filters.amountMax !== null) {
    result = result.filter(r => (r.printedGrandTotal ?? 0) <= filters.amountMax!);
  }
  if (filters.hasWarning !== null) {
    result = result.filter(r => {
      const has = (r.warnings.length > 0 || r.ambiguousFields.length > 0 || r.reconciliationStatus === 'mismatched');
      return filters.hasWarning ? has : !has;
    });
  }

  result = [...result].sort((a, b) => {
    let comparison = 0;
    switch (sort.field) {
      case 'date':
        // Handles nulls safely by falling back to empty string, pushing them to bottom or top depending on order
        comparison = (a.transactionDate || '').localeCompare(b.transactionDate || '');
        break;
      case 'total':
        comparison = (a.printedGrandTotal || 0) - (b.printedGrandTotal || 0);
        break;
      case 'merchant':
        comparison = (a.merchantNormalized || '').localeCompare(b.merchantNormalized || '');
        break;
    }
    return sort.order === 'asc' ? comparison : -comparison;
  });

  return result;
}
