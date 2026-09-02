import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ReceiptDocument } from '../../domain/schema';
import { getReceiptTotal } from '../../domain/reconciliation';
import { buildFinancialExportSummary } from './financialSummary';

type PdfWithAutoTable = jsPDF & { lastAutoTable?: { finalY?: number } };

export function exportPDF(receipts: ReceiptDocument[], dateRangeStr: string) {
  const doc = new jsPDF();
  const financialSummary = buildFinancialExportSummary(receipts);
  const confirmedReceipts = financialSummary.confirmedReceipts;
  
  doc.setFontSize(20);
  doc.text('BillsEye Expense Report', 14, 22);
  
  doc.setFontSize(11);
  doc.text(`Date Range: ${dateRangeStr}`, 14, 30);
  doc.text(`Generated On: ${new Date().toLocaleString()}`, 14, 36);
  
  doc.text(`Confirmed Receipts: ${confirmedReceipts.length}`, 14, 42);
  const totalLines = financialSummary.currencyTotals.length > 0
    ? financialSummary.currencyTotals.map(total => `Total Spent (${total.currency}): ${(total.totalMinor / 100).toFixed(2)}`)
    : ['Total Spent: Unavailable'];
  totalLines.forEach((line, index) => doc.text(line, 14, 48 + (index * 6)));
  const tableStartY = 55 + Math.max(0, totalLines.length - 1) * 6;

  const tableData = confirmedReceipts.map(r => {
    const total = getReceiptTotal(r);
    return [
      r.transactionDate || 'Unknown',
      r.merchantNormalized || r.merchantRaw || 'Unknown',
      total != null ? (total / 100).toFixed(2) : 'Unavailable',
      r.currency || 'PKR',
    ];
  });

  autoTable(doc, {
    startY: tableStartY,
    head: [['Date', 'Merchant', 'Total', 'Currency']],
    body: tableData,
    theme: 'grid',
    styles: { fontSize: 10 },
    headStyles: { fillColor: [41, 128, 185] },
  });

  doc.setFontSize(10);
  const finalY = (doc as PdfWithAutoTable).lastAutoTable?.finalY ?? tableStartY;
  doc.text('* Data quality note: Some receipts may have OCR discrepancies.', 14, finalY + 10);
  doc.text('* Note: RTL/Urdu script is not supported in this PDF export. Please use CSV/Excel.', 14, finalY + 15);

  return doc.output('arraybuffer');
}
