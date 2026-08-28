import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useReceiptQueue } from '../receipts/queue/ReceiptQueueContext';
import { canApplyPwaUpdate, getPwaUpdateDeferralReason } from './updateReadiness';
import { isE2eMockMode } from '../../config/e2eMocks';

interface PwaUpdateContextValue {
  setReceiptEditorDirty: (receiptId: string, isDirty: boolean) => void;
}

const PwaUpdateContext = createContext<PwaUpdateContextValue | undefined>(undefined);

function PwaUpdatePrompt({ editorIsDirty }: { editorIsDirty: boolean }) {
  const { items } = useReceiptQueue();
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const [isApplying, setIsApplying] = useState(false);
  const [e2eUpdateReady, setE2eUpdateReady] = useState(false);
  const mayApplyUpdate = canApplyPwaUpdate(editorIsDirty, items);
  const deferralReason = getPwaUpdateDeferralReason(editorIsDirty, items);

  useEffect(() => {
    if (!isE2eMockMode) return;
    const markUpdateReady = () => setE2eUpdateReady(true);
    window.addEventListener('kharchalens:e2e-pwa-update-ready', markUpdateReady);
    return () => window.removeEventListener('kharchalens:e2e-pwa-update-ready', markUpdateReady);
  }, []);

  if (!needRefresh && !e2eUpdateReady) return null;

  const applyUpdate = async () => {
    if (!mayApplyUpdate || isApplying) return;
    setIsApplying(true);
    try {
      if (e2eUpdateReady) {
        setE2eUpdateReady(false);
        return;
      }
      // With registerType: 'prompt', skipWaiting—and the resulting reload—only
      // happens after this explicit user action.
      await updateServiceWorker();
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <section
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-xl rounded-xl border border-blue-200 bg-white p-4 shadow-xl sm:left-auto"
      role="status"
      aria-live="polite"
      aria-label="Application update available"
    >
      <p className="font-semibold text-gray-900">A KharchaLens update is ready.</p>
      <p className="mt-1 text-sm text-gray-600">
        {deferralReason ?? 'Reload when ready to use the latest version.'}
      </p>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => void applyUpdate()}
          disabled={!mayApplyUpdate || isApplying}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isApplying ? 'Updating…' : 'Reload to update'}
        </button>
      </div>
    </section>
  );
}

export function PwaUpdateProvider({ children }: { children: React.ReactNode }) {
  const [dirtyReceiptIds, setDirtyReceiptIds] = useState<Set<string>>(() => new Set());
  const setReceiptEditorDirty = useCallback((receiptId: string, isDirty: boolean) => {
    setDirtyReceiptIds(current => {
      const alreadyDirty = current.has(receiptId);
      if (alreadyDirty === isDirty) return current;
      const next = new Set(current);
      if (isDirty) next.add(receiptId);
      else next.delete(receiptId);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ setReceiptEditorDirty }), [setReceiptEditorDirty]);

  return (
    <PwaUpdateContext.Provider value={value}>
      {children}
      <PwaUpdatePrompt editorIsDirty={dirtyReceiptIds.size > 0} />
    </PwaUpdateContext.Provider>
  );
}

export function usePwaUpdateReadiness(): PwaUpdateContextValue {
  const context = useContext(PwaUpdateContext);
  if (!context) throw new Error('usePwaUpdateReadiness must be used within a PwaUpdateProvider');
  return context;
}
