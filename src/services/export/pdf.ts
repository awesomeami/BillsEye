import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ReceiptDocument } from '../../domain/schema';

export function exportPDF(receipts: ReceiptDocument[], dateRangeStr: string) {
  const doc = new jsPDF();
  
  doc.setFontSize(20);
  doc.text('KharchaLens Expense Report', 14, 22);
  
  doc.setFontSize(11);
  doc.text(`Date Range: ${dateRangeStr}`, 14, 30);
  doc.text(`Generated On: ${new Date().toLocaleString()}`, 14, 36);
  
  const totalAmount = receipts.reduce((sum, r) => sum + (r.printedGrandTotal || 0), 0) / 100;
  doc.text(`Total Receipts: ${receipts.length}`, 14, 42);
  doc.text(`Total Spent: ${totalAmount.toFixed(2)}`, 14, 48);

  const tableData = receipts.map(r => [
    r.transactionDate || 'Unknown',
    r.merchantNormalized || r.merchantRaw || 'Unknown',
    r.printedGrandTotal !== null ? (r.printedGrandTotal / 100).toFixed(2) : 'Unknown',
    r.currency || 'PKR',
    r.status
  ]);

  autoTable(doc, {
    startY: 55,
    head: [['Date', 'Merchant', 'Total', 'Currency', 'Status']],
    body: tableData,
    theme: 'grid',
    styles: { fontSize: 10 },
    headStyles: { fillColor: [41, 128, 185] },
  });

  doc.setFontSize(10);
  const finalY = (doc as any).lastAutoTable?.finalY || 55;
  doc.text('* Data quality note: Some receipts may have OCR discrepancies.', 14, finalY + 10);
  doc.text('* Note: RTL/Urdu script is not supported in this PDF export. Please use CSV/Excel.', 14, finalY + 15);

  return doc.output('arraybuffer');
}
