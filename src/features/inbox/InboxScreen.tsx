import React, { useState } from 'react';
import { useToast } from '../../components/ui/Toast';
import { formatDate } from '../../utilities/config';
import { CheckCircle, Search, Trash2 } from 'lucide-react';
import { useReceiptsLibrary } from '../receipts/library/ReceiptsLibraryContext';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ReceiptDocument } from '../../domain/schema';
import { useClientSessionActionGuard } from '../auth/useClientSessionActionGuard';
import { ReceiptTotalValue } from '../../components/receipts/ReceiptTotalValue';
import { useReceiptQueue } from '../receipts/queue/ReceiptQueueContext';
import { RouteLoadingState } from '../../components/ui/LoadingState';

export function InboxScreen() {
  const sessionActions = useClientSessionActionGuard();
  const { showToast } = useToast();
  const { pendingReceipts, updateReceipt, deleteReceipt, loading } = useReceiptsLibrary();
  const { finalizeReceipt } = useReceiptQueue();
  
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleDelete = async () => {
    if (deleteId) {
      const scope = sessionActions.capture();
      if (!scope) return;
      const receiptId = deleteId;
      try {
        await deleteReceipt(receiptId);
        if (!sessionActions.isActive(scope)) return;
        finalizeReceipt(receiptId);
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
      finalizeReceipt(receipt.id);
    } catch {
      if (!sessionActions.isActive(scope)) return;
      console.error('Failed to confirm receipt.');
      showToast("Failed to confirm receipt. It may have been updated on another device.", "error");
    }
  };

  if (loading) return <RouteLoadingState />;

  return (
    <div className="space-y-6">
      <header className="page-header">
        <div><h1 className="page-title">AI Inbox</h1><p className="page-subtitle">Review and confirm receipts extracted by Gemini.</p></div>
      </header>

      {pendingReceipts.length === 0 ? (
        <div className="app-card py-16 text-center">
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
            return (
            <article key={receipt.id} className="app-card flex flex-col justify-between p-5">
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
                <div className="text-left sm:text-right">
                  <ReceiptTotalValue receipt={receipt} className="tabular-nums text-xl font-bold text-gray-950" />
                  <div className="text-sm text-gray-500 mt-1">{receipt.items.length} items found</div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2 border-t border-gray-100 pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem]">
                <button 
                  onClick={() => handleConfirm(receipt)}
                  className="btn-primary min-w-0 px-3">
                  <CheckCircle size={18} />
                  Confirm & Save
                </button>
                <Link 
                  to={`/receipts/${receipt.id}/review`}
                  className="btn-outline min-w-0 px-3">
                  <Search size={18} />
                  Review Details
                </Link>
                <button 
                  onClick={() => setDeleteId(receipt.id)}
                  aria-label="Delete receipt"
                  className="touch-target col-span-2 flex items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700 sm:col-span-1">
                  <Trash2 size={20} />
                </button>
              </div>
            </article>
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
