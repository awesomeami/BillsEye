function sanitizeCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return "'" + value;
  }
  return value;
}
import Papa from 'papaparse';
import { ReceiptDocument } from '../../domain/schema';

export function exportReceiptsCSV(receipts: ReceiptDocument[], addBom = true) {
  const data = receipts.map(r => ({
    id: r.id,
    date: r.transactionDate || r.createdAt,
    merchant: sanitizeCell(r.merchantNormalized || r.merchantRaw || 'Unknown'),
    total: r.printedGrandTotal != null ? r.printedGrandTotal / 100 : '',
    tax: r.printedTax != null ? r.printedTax / 100 : '',
    currency: r.currency,
    status: r.status,
    notes: sanitizeCell(r.userNote || '')
  }));

  const csv = Papa.unparse(data);
  return addBom ? '\uFEFF' + csv : csv;
}

export function exportItemsCSV(receipts: ReceiptDocument[], addBom = true) {
  const data = receipts.flatMap(r => 
    r.items.map(item => ({
      receiptId: r.id,
      receiptDate: r.transactionDate || r.createdAt,
      merchant: sanitizeCell(r.merchantNormalized || r.merchantRaw || 'Unknown'),
      itemId: item.id,
      itemName: sanitizeCell(item.name || item.rawLineText || 'Unknown'),
      quantity: item.quantity || 1,
      price: item.unitPrice != null ? item.unitPrice / 100 : '',
      total: item.lineTotal != null ? item.lineTotal / 100 : '',
      category: sanitizeCell(item.category || 'Uncategorized')
    }))
  );

  const csv = Papa.unparse(data);
  return addBom ? '\uFEFF' + csv : csv;
}
