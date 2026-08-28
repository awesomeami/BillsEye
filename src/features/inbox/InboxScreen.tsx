import React, { useState } from 'react';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency, formatDate } from '../../utilities/config';
import { CheckCircle, Search, Trash2 } from 'lucide-react';
import { useReceiptsLibrary } from '../receipts/library/ReceiptsLibraryContext';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ReceiptDocument } from '../../domain/schema';
import { ImageSessionStore } from '../../utils/imageSessionStore';
import { useClientSessionActionGuard } from '../auth/useClientSessionActionGuard';

export function InboxScreen() {
  const sessionActions = useClientSessionActionGuard();
  const { showToast } = useToast();
  const { pendingReceipts, updateReceipt, deleteReceipt } = useReceiptsLibrary();
  
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleDelete = async () => {
    if (deleteId) {
      const scope = sessionActions.capture();
      if (!scope) return;
      const receiptId = deleteId;
      try {
        await deleteReceipt(receiptId);
        if (!sessionActions.isActive(scope)) return;
        ImageSessionStore.deleteForUser(scope.uid, receiptId);
      } catch {
        if (!sessionActions.isActive(scope)) return;
        console.error('Failed to delete receipt.');
        showToast("Failed to delete receipt. Please try again.", "error");
      } finally {
        if (sessionActions.isActive(scope)) setDeleteId(null);
      }
    }
  };

  const handleConfirm = async (receipt: ReceiptDocument) => {
    const scope = sessionActions.capture();
    if (!scope) return;
    try {
      await updateReceipt(receipt.id, {
        // The repository supplies serverTimestamp() when confirmation changes,
        // so Firestore receives a timestamp rather than a client-side value.
        status: 'confirmed'
      }, receipt.revision);
      if (!sessionActions.isActive(scope)) return;
      ImageSessionStore.deleteForUser(scope.uid, receipt.id);
    } catch {
      if (!sessionActions.isActive(scope)) return;
      console.error('Failed to confirm receipt.');
      showToast("Failed to confirm receipt. It may have been updated on another device.", "error");
    }
  };

  return (
    <div className="space-y-6">
      <header className="pb-4 border-b border-gray-200">
        <h1 className="text-2xl font-bold text-gray-900">AI Inbox</h1>
        <p className="text-sm text-gray-500 mt-1">Review and confirm receipts extracted by Gemini.</p>
      </header>

      {pendingReceipts.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-50 mb-4">
            <CheckCircle size={32} className="text-green-500" />
          </div>
          <h2 className="text-lg font-medium text-gray-900">You're all caught up!</h2>
          <p className="text-gray-500 mt-1">No pending receipts to review.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingReceipts.map((receipt) => {
            const categories = Array.from(new Set(receipt.items.map(i => i.category).filter(Boolean)));
            const displayTotal = receipt.printedGrandTotal ?? receipt.computedLineTotal ?? 0;
            return (
            <div key={receipt.id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 flex flex-col justify-between">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{receipt.merchantNormalized || receipt.merchantRaw || 'Unknown Merchant'}</h3>
                  <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
                    <span>{receipt.transactionDate ? formatDate(receipt.transactionDate) : 'Unknown Date'}</span>
                    {categories.length > 0 && (
                      <>
                        <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                        <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-medium truncate max-w-[120px]">
                          {categories[0]}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-gray-900">{formatCurrency(displayTotal / 100)}</div>
                  <div className="text-sm text-gray-500 mt-1">{receipt.items.length} items found</div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-gray-100 flex gap-3 flex-wrap sm:flex-nowrap">
                <button 
                  onClick={() => handleConfirm(receipt)}
                  className="flex-1 min-w-[140px] bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors">
                  <CheckCircle size={18} />
                  Confirm & Save
                </button>
                <Link 
                  to={`/receipts/${receipt.id}/review`}
                  className="flex-1 min-w-[140px] bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors">
                  <Search size={18} />
                  Review Details
                </Link>
                <button 
                  onClick={() => setDeleteId(receipt.id)}
                  aria-label="Delete receipt"
                  className="w-full sm:w-auto bg-white border border-gray-300 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-gray-400 p-2.5 rounded-xl flex items-center justify-center transition-colors">
                  <Trash2 size={20} />
                </button>
              </div>
            </div>
          )})}
        </div>
      )}

      {deleteId && (
        <ConfirmDialog 
          isOpen={true} 
          title="Delete Receipt" 
          message="Are you sure you want to delete this receipt? This action cannot be undone." 
          onConfirm={handleDelete} 
          onCancel={() => setDeleteId(null)} 
          confirmText="Delete" 
          cancelText="Cancel"
                  />
      )}
    </div>
  );
}
