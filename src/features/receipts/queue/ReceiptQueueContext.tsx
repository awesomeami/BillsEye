import React, { createContext, useContext, useReducer, useEffect, useCallback, ReactNode, useRef } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useAiKeys } from '../../settings/ai/AiKeysContext';
import { queueReducer, QueueItem } from './queueReducer';
import { useQueueProcessor } from './useQueueProcessor';
import { ImageSessionStore } from '../../../utils/imageSessionStore';

interface ReceiptQueueContextType {
  items: QueueItem[];
  addFiles: (files: File[]) => Promise<void>;
  addPdfPages: (file: File, pages: number[]) => void;
  removeItem: (id: string) => void;
  releaseForReview: (id: string) => void;
  releaseReceiptForReview: (receiptId: string) => void;
  finalizeReceipt: (receiptId: string) => void;
  cancelItem: (id: string) => void;
  retryItem: (id: string) => void;
  updateCroppedImage: (id: string, newBlob: Blob) => void;
}

const ReceiptQueueContext = createContext<ReceiptQueueContextType | null>(null);

function disposeQueueItem(item: QueueItem, ownerUid: string | null, clearReviewImage = true) {
  if (!item.abortController.signal.aborted) item.abortController.abort();
  if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
  if (clearReviewImage && item.receiptId && ownerUid) ImageSessionStore.deleteForUser(ownerUid, item.receiptId);
}

export const ReceiptQueueProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { executor, getDecryptedKey, rotationManager } = useAiKeys();
  const [items, dispatch] = useReducer(queueReducer, []);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const userId = user?.uid ?? null;
  const previousUserIdRef = useRef<string | null>(userId);

  const clearQueue = useCallback(() => {
    itemsRef.current.forEach(item => disposeQueueItem(item, userId));
    itemsRef.current = [];
    if (userId) ImageSessionStore.clearForUser(userId);
    dispatch({ type: 'CLEAR_QUEUE' });
  }, [userId]);

  // Queue files and object URLs are owned by the active account only.
  useEffect(() => {
    if (previousUserIdRef.current !== userId) {
      clearQueue();
      previousUserIdRef.current = userId;
    }
  }, [userId, clearQueue]);

  useEffect(() => {
    return () => {
      clearQueue();
    };
  }, [clearQueue]);

  // A successful review hand-off uses ImageSessionStore, and duplicates cannot
  // be retried, so their queue preview URLs have no remaining consumer.
  useEffect(() => {
    const releasable = items.filter(item =>
      item.objectUrl && (item.status === 'needs-review' || item.status === 'duplicate')
    );
    if (releasable.length === 0) return;

    releasable.forEach(item => URL.revokeObjectURL(item.objectUrl!));
    itemsRef.current = itemsRef.current.map(item =>
      releasable.some(released => released.id === item.id) ? { ...item, objectUrl: undefined } : item
    );
    releasable.forEach(item => {
      dispatch({ type: 'UPDATE_ITEM', id: item.id, updates: { objectUrl: undefined } });
    });
  }, [items]);

  const warnBeforeUnload = useCallback((e: BeforeUnloadEvent) => {
    const hasMemoryOnlyWork = items.some(item => item.status !== 'duplicate' && item.status !== 'cancelled');
    if (hasMemoryOnlyWork) {
      e.preventDefault();
      e.returnValue = '';
    }
  }, [items]);

  useEffect(() => {
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [warnBeforeUnload]);

  // Activate the processor effect
  useQueueProcessor({
    state: items,
    dispatch,
    user,
    executor,
    getDecryptedKey,
    rotationManager
  });

  const addFiles = async (files: File[]) => {
    const newItems: QueueItem[] = [];
    
    for (const file of files) {
      if (file.type === 'application/pdf') {
        // PDF handling should be done via addPdfPages after user selects pages.
        // If passed here directly, we'll just extract all pages? The prompt says "let the user choose pages".
        // This method shouldn't be called directly with PDFs anymore without UI.
        // We'll throw or handle it in the UI layer.
        console.warn('PDF files should be processed via UI page selection first.');
        continue;
      }

      if (!file.type.startsWith('image/')) continue;
      
      const id = crypto.randomUUID();
      const objectUrl = URL.createObjectURL(file);
      newItems.push({
        id,
        file,
        originalName: file.name,
        mimeType: file.type,
        status: 'queued',
        objectUrl,
        abortController: new AbortController(),
        attempts: []
      });
    }
    
    if (newItems.length > 0) {
      itemsRef.current = [...itemsRef.current, ...newItems];
      dispatch({ type: 'ADD_ITEMS', items: newItems });
    }
  };

  const addPdfPages = (file: File, pages: number[]) => {
    const newItems: QueueItem[] = pages.map(page => ({
      id: crypto.randomUUID(),
      file, // Temporary, will be replaced by rendered blob during processing
      sourcePdf: file,
      pageNumber: page,
      originalName: `${file.name} (Page ${page})`,
      mimeType: 'application/pdf', // Temporary, will become image/jpeg
      status: 'queued',
      abortController: new AbortController(),
      attempts: []
    }));
    
    itemsRef.current = [...itemsRef.current, ...newItems];
    dispatch({ type: 'ADD_ITEMS', items: newItems });
  };

  const removeItem = (id: string) => {
    const item = itemsRef.current.find(candidate => candidate.id === id);
    if (item) disposeQueueItem(item, userId);
    itemsRef.current = itemsRef.current.filter(candidate => candidate.id !== id);
    dispatch({ type: 'REMOVE_ITEM', id });
  };
  const releaseForReview = useCallback((id: string) => {
    const item = itemsRef.current.find(candidate => candidate.id === id);
    if (!item || item.status !== 'needs-review') return;
    // The review editor uses the separate, memory-only session image. Release
    // queue state without deleting that hand-off image.
    disposeQueueItem(item, userId, false);
    itemsRef.current = itemsRef.current.filter(candidate => candidate.id !== id);
    dispatch({ type: 'REMOVE_ITEM', id });
  }, [userId]);
  const releaseReceiptForReview = useCallback((receiptId: string) => {
    itemsRef.current
      .filter(item => item.receiptId === receiptId && item.status === 'needs-review')
      .forEach(item => releaseForReview(item.id));
  }, [releaseForReview]);
  const finalizeReceipt = useCallback((receiptId: string) => {
    const matching = itemsRef.current.filter(item => item.receiptId === receiptId);
    matching.forEach(item => disposeQueueItem(item, userId));
    itemsRef.current = itemsRef.current.filter(item => item.receiptId !== receiptId);
    matching.forEach(item => dispatch({ type: 'REMOVE_ITEM', id: item.id }));
    if (userId) ImageSessionStore.deleteForUser(userId, receiptId);
  }, [userId]);
  const cancelItem = (id: string) => {
    const item = itemsRef.current.find(candidate => candidate.id === id);
    if (item && !item.abortController.signal.aborted) item.abortController.abort();
    dispatch({ type: 'CANCEL_ITEM', id });
  };
  const retryItem = (id: string) => dispatch({ type: 'RETRY_ITEM', id });

  const updateCroppedImage = (id: string, newBlob: Blob) => {
    const item = itemsRef.current.find(i => i.id === id);
    if (!item) return;
    if (item.objectUrl) {
      URL.revokeObjectURL(item.objectUrl);
    }
    const objectUrl = URL.createObjectURL(newBlob);
    itemsRef.current = itemsRef.current.map(candidate =>
      candidate.id === id ? { ...candidate, file: newBlob, objectUrl, mimeType: 'image/jpeg' } : candidate
    );
    dispatch({ type: 'UPDATE_ITEM', id, updates: { file: newBlob, objectUrl, mimeType: 'image/jpeg' } });
  };

  return (
    <ReceiptQueueContext.Provider value={{ items, addFiles, addPdfPages, removeItem, releaseForReview, releaseReceiptForReview, finalizeReceipt, cancelItem, retryItem, updateCroppedImage }}>
      {children}
    </ReceiptQueueContext.Provider>
  );
};

export const useReceiptQueue = () => {
  const context = useContext(ReceiptQueueContext);
  if (!context) {
    throw new Error('useReceiptQueue must be used within ReceiptQueueProvider');
  }
  return context;
};
