import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { receiptRepository, categoryRepository, settingsRepository } from '../../../services/firebase/db';
import { ReceiptDocument, CategoryDocument, AppSettingsDocument, AppSettingsSchema } from '../../../domain/schema';
import { filterAndSortReceipts, FilterState, SortState } from './libraryUtils';

interface ReceiptsLibraryContextType {
  receipts: ReceiptDocument[];
  pendingReceipts: ReceiptDocument[];
  filteredReceipts: ReceiptDocument[];
  categories: CategoryDocument[];
  settings: AppSettingsDocument;
  loading: boolean;
  error: Error | null;
  syncState: 'syncing' | 'synced' | 'offline' | 'error';
  lastSyncedAt: Date | null;
  filters: FilterState;
  sort: SortState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  setSort: React.Dispatch<React.SetStateAction<SortState>>;
  deleteReceipt: (id: string) => Promise<void>;
  updateReceipt: (id: string, data: Partial<ReceiptDocument>, currentVersion?: number) => Promise<void>;
}

const ReceiptsLibraryContext = createContext<ReceiptsLibraryContextType | undefined>(undefined);

export function ReceiptsLibraryProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [receipts, setReceipts] = useState<ReceiptDocument[]>([]);
  const [pendingReceipts, setPendingReceipts] = useState<ReceiptDocument[]>([]);
  const [categories, setCategories] = useState<CategoryDocument[]>([]);
  const [settings, setSettings] = useState<AppSettingsDocument>(() => AppSettingsSchema.parse({}));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [syncState, setSyncState] = useState<'syncing' | 'synced' | 'offline' | 'error'>('syncing');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const [filters, setFilters] = useState<FilterState>({
    searchQuery: '',
    dateStart: null,
    dateEnd: null,
    merchant: null,
    category: null,
    item: null,
    paymentMethod: null,
    amountMin: null,
    amountMax: null,
    hasWarning: null,
  });

  const [sort, setSort] = useState<SortState>({ field: 'date', order: 'desc' });

  useEffect(() => {
    if (!user) {
      setReceipts([]);
      setPendingReceipts([]);
      setCategories([]);
      setSettings(AppSettingsSchema.parse({}));
      setLoading(false);
      return;
    }

    setSyncState('syncing');
    
    let isInitialReceiptLoad = true;
    let isInitialPendingLoad = true;

    const checkLoading = () => {
      if (!isInitialReceiptLoad && !isInitialPendingLoad) {
        setLoading(false);
      }
    };

    const unsubReceipts = receiptRepository.subscribeToReceipts(user.uid, (data) => {
      setReceipts(data);
      setSyncState('synced');
      setLastSyncedAt(new Date());
      if (isInitialReceiptLoad) {
        isInitialReceiptLoad = false;
        checkLoading();
      }
    }, (err) => {
      console.error(err);
      if (err.message.includes('offline')) {
        setSyncState('offline');
      } else {
        setSyncState('error');
        setError(err);
      }
      isInitialReceiptLoad = false;
      checkLoading();
    });

    const unsubPending = receiptRepository.subscribeToPendingReceipts(user.uid, (data) => {
      setPendingReceipts(data);
      if (isInitialPendingLoad) {
        isInitialPendingLoad = false;
        checkLoading();
      }
    }, (err) => {
      console.error(err);
      isInitialPendingLoad = false;
      checkLoading();
    });

    const unsubCategories = categoryRepository.subscribeToCategories(user.uid, (data) => {
      setCategories(data);
    }, (err) => {
      console.error(err);
    });

    const unsubSettings = settingsRepository.subscribeToSettings(user.uid, setSettings, (err) => {
      console.error(err);
    });

    return () => {
      unsubReceipts();
      unsubPending();
      unsubCategories();
      unsubSettings();
    };
  }, [user]);

  useEffect(() => {
    const handleOnline = () => setSyncState('syncing');
    const handleOffline = () => setSyncState('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
  }, []);

  const filteredReceipts = useMemo(() => {
    return filterAndSortReceipts(receipts, filters, sort);
  }, [receipts, filters, sort]);

  const deleteReceipt = async (id: string) => {
    if (!user) return;
    await receiptRepository.deleteReceipt(user.uid, id);
  };

  const updateReceipt = async (id: string, data: Partial<ReceiptDocument>, currentVersion?: number) => {
    if (!user) return;
    await receiptRepository.updateReceipt(user.uid, id, data, currentVersion);
  };

  return (
    <ReceiptsLibraryContext.Provider value={{
      receipts,
      pendingReceipts,
      filteredReceipts,
      categories,
      settings,
      loading,
      error,
      syncState,
      lastSyncedAt,
      filters,
      sort,
      setFilters,
      setSort,
      deleteReceipt,
      updateReceipt
    }}>
      {children}
    </ReceiptsLibraryContext.Provider>
  );
}

export function useReceiptsLibrary() {
  const context = useContext(ReceiptsLibraryContext);
  if (context === undefined) {
    throw new Error('useReceiptsLibrary must be used within a ReceiptsLibraryProvider');
  }
  return context;
}
