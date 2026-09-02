import ExcelJS from 'exceljs';
import { ReceiptDocument, CategoryDocument } from '../../domain/schema';
import { calculateReceiptTotals, getReceiptTotal } from '../../domain/reconciliation';

function sanitizeCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return "'" + value;
  }
  return value;
}

export async function exportExcel(receipts: ReceiptDocument[], categories: CategoryDocument[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BillsEye';
  workbook.lastModifiedBy = 'BillsEye';
  workbook.created = new Date();
  workbook.modified = new Date();

  // Summary Sheet
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 25 },
    { header: 'Value', key: 'value', width: 20 }
  ];
  summarySheet.addRow({ metric: 'Total Receipts', value: receipts.length });
  const knownReceiptTotals = receipts
    .map((receipt) => getReceiptTotal(receipt))
    .filter((total): total is number => total != null);
  const totalAmount = knownReceiptTotals.length > 0
    ? knownReceiptTotals.reduce((sum, total) => sum + total, 0) / 100
    : null;
  summarySheet.addRow({ metric: 'Total Amount Spent', value: totalAmount ?? 'Unavailable' });
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  // Receipts Sheet
  const receiptsSheet = workbook.addWorksheet('Receipts');
  receiptsSheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Merchant', key: 'merchant', width: 25 },
    { header: 'Total', key: 'total', width: 15 },
    { header: 'Tax', key: 'tax', width: 15 },
    { header: 'Currency', key: 'currency', width: 10 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Notes', key: 'notes', width: 30 },
  ];
  receipts.forEach(r => {
    const total = getReceiptTotal(r);
    receiptsSheet.addRow({
      date: r.transactionDate || r.createdAt,
      merchant: sanitizeCell(r.merchantNormalized || r.merchantRaw || 'Unknown'),
      total: total != null ? total / 100 : null,
      tax: r.printedTax != null ? r.printedTax / 100 : null,
      currency: r.currency,
      status: r.status,
      notes: sanitizeCell(r.userNote || '')
    });
  });
  receiptsSheet.getRow(1).font = { bold: true };
  receiptsSheet.autoFilter = 'A1:G1';
  receiptsSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  // Items Sheet
  const itemsSheet = workbook.addWorksheet('Items');
  itemsSheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Merchant', key: 'merchant', width: 25 },
    { header: 'Item Name', key: 'itemName', width: 30 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Quantity', key: 'qty', width: 10 },
    { header: 'Unit Price', key: 'price', width: 15 },
    { header: 'Total', key: 'total', width: 15 },
  ];
  receipts.forEach(r => {
    r.items.forEach(item => {
      itemsSheet.addRow({
        date: r.transactionDate || r.createdAt,
        merchant: sanitizeCell(r.merchantNormalized || r.merchantRaw || 'Unknown'),
        itemName: sanitizeCell(item.name || item.rawLineText || 'Unknown'),
        category: sanitizeCell(item.category || 'Uncategorized'),
        qty: item.quantity || 1,
        price: item.unitPrice != null ? item.unitPrice / 100 : null,
        total: item.lineTotal != null ? item.lineTotal / 100 : null
      });
    });
  });
  itemsSheet.getRow(1).font = { bold: true };
  itemsSheet.autoFilter = 'A1:G1';
  itemsSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  // Categories Sheet
  const catSheet = workbook.addWorksheet('Categories');
  catSheet.columns = [
    { header: 'Category Name', key: 'name', width: 25 },
    { header: 'Is Custom', key: 'custom', width: 15 },
  ];
  categories.forEach(c => {
    catSheet.addRow({ name: c.name, custom: c.isCustom ? 'Yes' : 'No' });
  });
  catSheet.getRow(1).font = { bold: true };
  catSheet.autoFilter = 'A1:B1';
  catSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  // Merchants Sheet
  const merchantsSheet = workbook.addWorksheet('Merchants');
  merchantsSheet.columns = [
    { header: 'Merchant', key: 'merchant', width: 25 },
    { header: 'Visits', key: 'visits', width: 15 },
    { header: 'Total Spent', key: 'total', width: 20 },
  ];
  const merchantStats = receipts.reduce((acc, r) => {
    const name = r.merchantNormalized || r.merchantRaw || 'Unknown';
    if (!acc[name]) acc[name] = { visits: 0, total: 0, knownTotalCount: 0 };
    acc[name].visits += 1;
    const total = getReceiptTotal(r);
    if (total != null) {
      acc[name].total += total / 100;
      acc[name].knownTotalCount += 1;
    }
    return acc;
  }, {} as Record<string, { visits: number, total: number, knownTotalCount: number }>);
  
  Object.entries(merchantStats).forEach(([name, stats]) => {
    merchantsSheet.addRow({ merchant: sanitizeCell(name), visits: stats.visits, total: stats.knownTotalCount > 0 ? stats.total : null });
  });
  merchantsSheet.getRow(1).font = { bold: true };
  merchantsSheet.autoFilter = 'A1:C1';
  merchantsSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  // Item Price History Sheet
  const priceHistorySheet = workbook.addWorksheet('Item Price History');
  priceHistorySheet.columns = [
    { header: 'Item Name', key: 'itemName', width: 30 },
    { header: 'Merchant', key: 'merchant', width: 25 },
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Unit Price', key: 'price', width: 15 },
  ];
  receipts.forEach(r => {
    r.items.forEach(item => {
      priceHistorySheet.addRow({
        itemName: sanitizeCell(item.name || item.rawLineText || 'Unknown'),
        merchant: sanitizeCell(r.merchantNormalized || r.merchantRaw || 'Unknown'),
        date: r.transactionDate || r.createdAt,
        price: item.unitPrice != null ? item.unitPrice / 100 : null
      });
    });
  });
  priceHistorySheet.getRow(1).font = { bold: true };
  priceHistorySheet.autoFilter = 'A1:D1';
  priceHistorySheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  // Data Quality Sheet
  const dqSheet = workbook.addWorksheet('Data Quality');
  dqSheet.columns = [
    { header: 'Receipt ID', key: 'id', width: 20 },
    { header: 'Merchant', key: 'merchant', width: 25 },
    { header: 'Printed − Calculated', key: 'disc', width: 22 },
    { header: 'Missing Fields', key: 'missing', width: 30 },
  ];
  receipts.forEach(r => {
    const reconciliation = calculateReceiptTotals(r.items, r);
    const missing: string[] = [];
    if (!r.merchantNormalized) missing.push('Merchant');
    if (!r.transactionDate) missing.push('Date');
    if (getReceiptTotal(r) == null) missing.push('Total');
    
    if (missing.length > 0 || reconciliation.discrepancy !== 0) {
      dqSheet.addRow({
        id: r.id,
        merchant: sanitizeCell(r.merchantNormalized || r.merchantRaw || 'Unknown'),
        disc: reconciliation.discrepancy != null ? reconciliation.discrepancy / 100 : null,
        missing: missing.join(', ')
      });
    }
  });
  dqSheet.getRow(1).font = { bold: true };
  dqSheet.autoFilter = 'A1:D1';
  dqSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}
