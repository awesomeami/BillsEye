import { useState } from 'react';
import { formatCurrency, formatDate } from '../../../utilities/config';
import { AlertTriangle, Trash2, Edit2, X, Save } from 'lucide-react';
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

export function ReceiptDetailModal({ receipt, onClose, onDelete }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<ReceiptDocument>(receipt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { updateReceipt, categories, settings } = useReceiptsLibrary();
  const displayedReconciliation = calculateReceiptTotals(receipt.items, receipt, settings.discrepancyTolerance);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const reconciliation = calculateReceiptTotals(editData.items, editData, settings.discrepancyTolerance);
      const newWarnings = editData.warnings.filter((warning) => ![
        'Totals mismatch',
        'Printed total is higher than calculated total',
        'Calculated total is higher than printed total',
      ].includes(warning));
      if (reconciliation.reconciliationStatus === 'mismatched') {
        newWarnings.push(getDiscrepancyLabel(reconciliation.discrepancyDirection));
      }

      const updated: Partial<ReceiptDocument> = {
        ...editData,
        computedLineTotal: reconciliation.computedLineTotal,
        computedExpectedTotal: reconciliation.computedExpectedTotal,
        discrepancy: reconciliation.discrepancy,
        reconciliationStatus: reconciliation.reconciliationStatus,
        warnings: newWarnings,
        wasEditedByUser: true,
      };

      await updateReceipt(receipt.id, updated, receipt.revision);

      setIsEditing(false);
      onClose(); // Close modal on save
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white">
          <h2 id="modal-title" className="text-lg font-bold flex items-center gap-2">
            Receipt Details
            {receipt.wasEditedByUser && <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs">Edited</span>}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 p-1">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-amber-50 text-amber-800 p-3 rounded-lg text-sm flex gap-2">
            <AlertTriangle size={18} className="shrink-0" />
            <p>Original image was not stored for privacy reasons. Only textual data is available.</p>
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 uppercase font-medium">Merchant</label>
              {isEditing ? (
                <input 
                  type="text" 
                  className="w-full mt-1 border border-gray-300 rounded p-1.5 text-sm"
                  value={editData.merchantNormalized || editData.merchantRaw || ''}
                  onChange={e => setEditData({...editData, merchantNormalized: e.target.value})}
                />
              ) : (
                <p className="font-medium text-gray-900">{receipt.merchantNormalized || receipt.merchantRaw}</p>
              )}
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase font-medium">Date</label>
              {isEditing ? (
                <input 
                  type="date" 
                  className="w-full mt-1 border border-gray-300 rounded p-1.5 text-sm"
                  value={editData.transactionDate || ''}
                  onChange={e => setEditData({...editData, transactionDate: e.target.value})}
                />
              ) : (
                <p className="font-medium text-gray-900">{formatDate(receipt.transactionDate || '')}</p>
              )}
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase font-medium">Grand Total</label>
              {isEditing ? (
                <input 
                  type="number" 
                  step="0.01"
                  className="w-full mt-1 border border-gray-300 rounded p-1.5 text-sm"
                  value={editData.printedGrandTotal !== null && editData.printedGrandTotal !== undefined ? (editData.printedGrandTotal / 100).toFixed(2) : ''}
                  onChange={e => setEditData({...editData, printedGrandTotal: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100)})}
                />
              ) : (
                <ReceiptTotalValue receipt={receipt} className="font-medium text-gray-900" />
              )}
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase font-medium">Status</label>
              <div className="flex items-center gap-1 mt-1">
                <p className="font-medium capitalize text-gray-900">{displayedReconciliation.reconciliationStatus}</p>
                {displayedReconciliation.reconciliationStatus === 'mismatched' && <AlertTriangle size={14} className="text-amber-500" />}
              </div>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-end border-b pb-2 mb-3">
              <h3 className="font-bold text-sm text-gray-900">Items</h3>
            </div>
            <ul className="space-y-3">
              {editData.items.map((item, idx) => (
                <li key={item.id} className="flex gap-2 text-sm items-start">
                  {isEditing ? (
                    <>
                      <input 
                        type="text" 
                        className="w-full border border-gray-300 rounded p-1.5" 
                        value={item.name || item.rawLineText || ''}
                        onChange={e => {
                          const newItems = [...editData.items];
                          newItems[idx].name = e.target.value;
                          setEditData({...editData, items: newItems});
                        }}
                      />
                      <input 
                        type="number" 
                        step="0.01"
                        className="w-24 border border-gray-300 rounded p-1.5 shrink-0" 
                        value={item.lineTotal !== null && item.lineTotal !== undefined ? (item.lineTotal / 100).toFixed(2) : ''}
                        onChange={e => {
                          const newItems = [...editData.items];
                          newItems[idx].lineTotal = e.target.value === '' ? null : Math.round(Number(e.target.value) * 100);
                          setEditData({...editData, items: newItems});
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <div className="flex-1">
                        <span>{item.quantity ? `${item.quantity}x ` : ''}{item.name || item.rawLineText}</span>
                        {(item.categoryId || item.category) && <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{getReceiptItemCategoryLabel(item, categories)}</span>}
                      </div>
                      <span className="font-medium whitespace-nowrap">{formatOptionalMinor(item.lineTotal)}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm bg-gray-50 rounded-lg p-3">
            <div><span className="text-gray-500">Calculated total</span><p className="font-medium">{formatOptionalMinor(displayedReconciliation.computedExpectedTotal)}</p></div>
            <div><span className="text-gray-500">Printed − calculated</span><p className="font-medium">{formatOptionalMinor(displayedReconciliation.discrepancy)}</p></div>
            <div><span className="text-gray-500">Comparison</span><p className="font-medium">{getDiscrepancyLabel(displayedReconciliation.discrepancyDirection)}</p></div>
          </div>

          {(receipt.warnings.length > 0 || receipt.ambiguousFields.length > 0) && (
            <div>
              <h3 className="font-bold text-sm border-b pb-2 mb-3 text-red-800">Extraction Warnings</h3>
              <ul className="list-disc pl-5 text-sm text-red-700 space-y-1">
                {receipt.warnings.map((w, i) => <li key={i}>{w}</li>)}
                {receipt.ambiguousFields.map((f, i) => <li key={i}>Ambiguous field: {f}</li>)}
              </ul>
            </div>
          )}

          {receipt.rawOcrText && (
            <div>
              <h3 className="font-bold text-sm border-b pb-2 mb-3 text-gray-900">Raw OCR Output</h3>
              <pre className="text-xs text-gray-500 bg-gray-50 p-3 rounded whitespace-pre-wrap max-h-40 overflow-y-auto">
                {receipt.rawOcrText}
              </pre>
            </div>
          )}
          
          <div className="text-xs text-gray-400">
            Added on {new Date(receipt.createdAt).toLocaleString()}
          </div>

          <div className="flex justify-between pt-4 border-t border-gray-200">
            <button 
              onClick={onDelete} 
              disabled={saving}
              className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-2 disabled:opacity-50"
            >
              <Trash2 size={16} /> Delete Receipt
            </button>
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <button
                    onClick={() => { setIsEditing(false); setEditData(JSON.parse(JSON.stringify(receipt))); }}
                    disabled={saving}
                    className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {saving ? 'Saving...' : <><Save size={16}/> Save Changes</>}
                  </button>
                </>
              ) : (
                <button 
                  onClick={() => { setIsEditing(true); setEditData(JSON.parse(JSON.stringify(receipt))); }} 
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 flex items-center gap-2"
                >
                  <Edit2 size={16} /> Edit
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
