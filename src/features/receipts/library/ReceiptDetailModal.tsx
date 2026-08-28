import { useNavigate } from 'react-router-dom';
import { formatCurrency, formatDate } from '../../../utilities/config';
import { AlertTriangle, Edit2, Trash2, X } from 'lucide-react';
import { ReceiptDocument } from '../../../domain/schema';
import { useReceiptsLibrary } from './ReceiptsLibraryContext';
import { getReceiptItemCategoryLabel } from '../../../domain/categories';
import { calculateReceiptTotals, getDiscrepancyLabel } from '../../../domain/reconciliation';
import { ReceiptTotalValue } from '../../../components/receipts/ReceiptTotalValue';

interface Props {
  receipt: ReceiptDocument;
  onClose: () => void;
  onDelete: () => void;
}

function formatOptionalMinor(value: number | null | undefined): string {
  return value == null ? 'Unavailable' : formatCurrency(value / 100);
}

/** Read-only summary. All receipt changes use the full, conflict-safe review editor. */
export function ReceiptDetailModal({ receipt, onClose, onDelete }: Props) {
  const navigate = useNavigate();
  const { categories, settings } = useReceiptsLibrary();
  const reconciliation = calculateReceiptTotals(receipt.items, receipt, settings.discrepancyTolerance);

  const openEditor = () => {
    onClose();
    navigate(`/receipts/${receipt.id}/review`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="receipt-detail-title" className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white z-10">
          <h2 id="receipt-detail-title" className="text-lg font-bold flex items-center gap-2">
            Receipt Details
            {receipt.wasEditedByUser && <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs">Edited</span>}
          </h2>
          <button onClick={onClose} aria-label="Close receipt details" className="text-gray-500 hover:text-gray-700 p-1">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-amber-50 text-amber-800 p-3 rounded-lg text-sm flex gap-2">
            <AlertTriangle size={18} className="shrink-0" />
            <p>Original image was not stored for privacy reasons. Only textual data is available.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div><span className="text-xs text-gray-500 uppercase font-medium">Merchant</span><p className="font-medium text-gray-900">{receipt.merchantNormalized || receipt.merchantRaw || 'Unknown merchant'}</p></div>
            <div><span className="text-xs text-gray-500 uppercase font-medium">Date</span><p className="font-medium text-gray-900">{formatDate(receipt.transactionDate || '')}</p></div>
            <div><span className="text-xs text-gray-500 uppercase font-medium">Grand Total</span><ReceiptTotalValue receipt={receipt} className="block font-medium text-gray-900" /></div>
            <div><span className="text-xs text-gray-500 uppercase font-medium">Status</span><p className="font-medium capitalize text-gray-900">{reconciliation.reconciliationStatus}</p></div>
          </div>

          <div>
            <h3 className="font-bold text-sm text-gray-900 border-b pb-2 mb-3">Items</h3>
            <ul className="space-y-3">
              {receipt.items.map((item) => (
                <li key={item.id} className="flex gap-2 text-sm items-start">
                  <div className="flex-1">
                    <span>{item.quantity ? `${item.quantity}x ` : ''}{item.name || item.rawLineText || 'Unknown item'}</span>
                    {(item.categoryId || item.category) && <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{getReceiptItemCategoryLabel(item, categories)}</span>}
                  </div>
                  <span className="font-medium whitespace-nowrap">{formatOptionalMinor(item.lineTotal)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm bg-gray-50 rounded-lg p-3">
            <div><span className="text-gray-500">Calculated total</span><p className="font-medium">{formatOptionalMinor(reconciliation.computedExpectedTotal)}</p></div>
            <div><span className="text-gray-500">Printed − calculated</span><p className="font-medium">{formatOptionalMinor(reconciliation.discrepancy)}</p></div>
            <div><span className="text-gray-500">Comparison</span><p className="font-medium">{getDiscrepancyLabel(reconciliation.discrepancyDirection)}</p></div>
          </div>

          {(receipt.warnings.length > 0 || receipt.ambiguousFields.length > 0) && (
            <div>
              <h3 className="font-bold text-sm border-b pb-2 mb-3 text-red-800">Extraction Warnings</h3>
              <ul className="list-disc pl-5 text-sm text-red-700 space-y-1">
                {receipt.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                {receipt.ambiguousFields.map((field, index) => <li key={index}>Ambiguous field: {field}</li>)}
              </ul>
            </div>
          )}

          {receipt.rawOcrText && <pre className="text-xs text-gray-500 bg-gray-50 p-3 rounded whitespace-pre-wrap max-h-40 overflow-y-auto">{receipt.rawOcrText}</pre>}

          <div className="flex justify-between gap-3 pt-4 border-t border-gray-200">
            <button onClick={onDelete} className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-2"><Trash2 size={16} /> Delete Receipt</button>
            <button onClick={openEditor} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2"><Edit2 size={16} /> Open Full Editor</button>
          </div>
        </div>
      </div>
    </div>
  );
}
