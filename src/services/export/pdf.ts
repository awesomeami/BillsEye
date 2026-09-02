import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ReceiptDocument } from '../../domain/schema';
import { getReceiptTotal } from '../../domain/reconciliation';

type PdfWithAutoTable = jsPDF & { lastAutoTable?: { finalY?: number } };

export function exportPDF(receipts: ReceiptDocument[], dateRangeStr: string) {
  const doc = new jsPDF();
  
  doc.setFontSize(20);
  doc.text('BillsEye Expense Report', 14, 22);
  
  doc.setFontSize(11);
  doc.text(`Date Range: ${dateRangeStr}`, 14, 30);
  doc.text(`Generated On: ${new Date().toLocaleString()}`, 14, 36);
  
  const knownTotals = receipts
    .map((receipt) => getReceiptTotal(receipt))
    .filter((total): total is number => total != null);
  const totalAmount = knownTotals.length > 0
    ? knownTotals.reduce((sum, total) => sum + total, 0) / 100
    : null;
  doc.text(`Total Receipts: ${receipts.length}`, 14, 42);
  doc.text(`Total Spent: ${totalAmount == null ? 'Unavailable' : totalAmount.toFixed(2)}`, 14, 48);

  const tableData = receipts.map(r => {
    const total = getReceiptTotal(r);
    return [
      r.transactionDate || 'Unknown',
      r.merchantNormalized || r.merchantRaw || 'Unknown',
      total != null ? (total / 100).toFixed(2) : 'Unavailable',
      r.currency || 'PKR',
      r.status
    ];
  });

  autoTable(doc, {
    startY: 55,
    head: [['Date', 'Merchant', 'Total', 'Currency', 'Status']],
    body: tableData,
    theme: 'grid',
    styles: { fontSize: 10 },
    headStyles: { fillColor: [41, 128, 185] },
  });

  doc.setFontSize(10);
  const finalY = (doc as PdfWithAutoTable).lastAutoTable?.finalY ?? 55;
  doc.text('* Data quality note: Some receipts may have OCR discrepancies.', 14, finalY + 10);
  doc.text('* Note: RTL/Urdu script is not supported in this PDF export. Please use CSV/Excel.', 14, finalY + 15);

  return doc.output('arraybuffer');
}
