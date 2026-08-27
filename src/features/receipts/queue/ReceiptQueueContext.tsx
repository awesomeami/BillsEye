import React, { createContext, useContext, useReducer, useEffect, useCallback, ReactNode, useRef } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useAiKeys } from '../../settings/ai/AiKeysContext';
import { queueReducer, QueueItem, QueueAction } from './queueReducer';
import { useQueueProcessor } from './useQueueProcessor';

interface ReceiptQueueContextType {
  items: QueueItem[];
  addFiles: (files: File[]) => Promise<void>;
  addPdfPages: (file: File, pages: number[]) => void;
  removeItem: (id: string) => void;
  cancelItem: (id: string) => void;
  retryItem: (id: string) => void;
  updateCroppedImage: (id: string, newBlob: Blob) => void;
}

const ReceiptQueueContext = createContext<ReceiptQueueContextType | null>(null);

export const ReceiptQueueProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { executor, getDecryptedKey, rotationManager } = useAiKeys();
  const [items, dispatch] = useReducer(queueReducer, []);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Cleanup object urls on unmount
  useEffect(() => {
    return () => {
      itemsRef.current.forEach(item => {
        if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
        item.abortController.abort();
      });
    };
  }, []);

  const warnBeforeUnload = useCallback((e: BeforeUnloadEvent) => {
    const hasActive = items.some(i => !['completed', 'failed-permanent', 'cancelled', 'needs-review', 'duplicate'].includes(i.status));
    if (hasActive) {
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
    
    dispatch({ type: 'ADD_ITEMS', items: newItems });
  };

  const removeItem = (id: string) => dispatch({ type: 'REMOVE_ITEM', id });
  const cancelItem = (id: string) => dispatch({ type: 'CANCEL_ITEM', id });
  const retryItem = (id: string) => dispatch({ type: 'RETRY_ITEM', id });

  const updateCroppedImage = (id: string, newBlob: Blob) => {
    const item = items.find(i => i.id === id);
    if (item?.objectUrl) {
      URL.revokeObjectURL(item.objectUrl);
    }
    const objectUrl = URL.createObjectURL(newBlob);
    dispatch({ type: 'UPDATE_ITEM', id, updates: { file: newBlob, objectUrl, mimeType: 'image/jpeg' } });
  };

  return (
    <ReceiptQueueContext.Provider value={{ items, addFiles, addPdfPages, removeItem, cancelItem, retryItem, updateCroppedImage }}>
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
