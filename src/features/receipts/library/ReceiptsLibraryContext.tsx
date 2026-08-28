import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { receiptRepository, categoryRepository, settingsRepository } from '../../../services/firebase/db';
import { ReceiptDocument, CategoryDocument, AppSettingsDocument, AppSettingsSchema } from '../../../domain/schema';
import { filterAndSortReceipts, FilterState, SortState } from './libraryUtils';
import { ActiveSessionGuard } from '../../../services/firebase/subscriptionIsolation';

const initialFilters: FilterState = {
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
};

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
  updateReceipt: (id: string, data: Partial<ReceiptDocument>, currentVersion?: number) => Promise<ReceiptDocument>;
}

const ReceiptsLibraryContext = createContext<ReceiptsLibraryContextType | undefined>(undefined);

export function ReceiptsLibraryProvider({ children }: { children: React.ReactNode }) {
  const { user, sessionEpoch } = useAuth();
  const userId = user?.uid ?? null;
  const sessionGuardRef = useRef(new ActiveSessionGuard());
  const [receipts, setReceipts] = useState<ReceiptDocument[]>([]);
  const [pendingReceipts, setPendingReceipts] = useState<ReceiptDocument[]>([]);
  const [categories, setCategories] = useState<CategoryDocument[]>([]);
  const [settings, setSettings] = useState<AppSettingsDocument>(() => AppSettingsSchema.parse({}));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [syncState, setSyncState] = useState<'syncing' | 'synced' | 'offline' | 'error'>('syncing');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const [filters, setFilters] = useState<FilterState>(initialFilters);

  const [sort, setSort] = useState<SortState>({ field: 'date', order: 'desc' });

  useEffect(() => {
    const sessionGuard = sessionGuardRef.current;
    const resetState = (isLoading: boolean) => {
      setReceipts([]);
      setPendingReceipts([]);
      setCategories([]);
      setSettings(AppSettingsSchema.parse({}));
      setLoading(isLoading);
      setError(null);
      setSyncState(isLoading ? 'syncing' : 'synced');
      setLastSyncedAt(null);
      setFilters(initialFilters);
      setSort({ field: 'date', order: 'desc' });
    };

    sessionGuard.invalidate();
    if (!userId) {
      resetState(false);
      return;
    }

    resetState(true);
    const scope = sessionGuard.activate(userId);
    const isActive = () => sessionGuard.isActive(scope);
    
    let isInitialReceiptLoad = true;
    let isInitialPendingLoad = true;

    const checkLoading = () => {
      if (isActive() && !isInitialReceiptLoad && !isInitialPendingLoad) {
        setLoading(false);
      }
    };

    const unsubReceipts = receiptRepository.subscribeToReceipts(userId, (data) => {
      if (!isActive()) return;
      setReceipts(data);
      setSyncState('synced');
      setLastSyncedAt(new Date());
      if (isInitialReceiptLoad) {
        isInitialReceiptLoad = false;
        checkLoading();
      }
    }, (err) => {
      if (!isActive()) return;
      if (err.message.includes('offline')) {
        setSyncState('offline');
      } else {
        setSyncState('error');
        setError(err);
      }
      isInitialReceiptLoad = false;
      checkLoading();
    });

    const unsubPending = receiptRepository.subscribeToPendingReceipts(userId, (data) => {
      if (!isActive()) return;
      setPendingReceipts(data);
      if (isInitialPendingLoad) {
        isInitialPendingLoad = false;
        checkLoading();
      }
    }, () => {
      if (!isActive()) return;
      isInitialPendingLoad = false;
      checkLoading();
    });

    const unsubCategories = categoryRepository.subscribeToCategories(userId, (data) => {
      if (isActive()) setCategories(data);
    }, () => {
      if (isActive()) setError(new Error('Could not load categories.'));
    });

    const unsubSettings = settingsRepository.subscribeToSettings(userId, data => {
      if (isActive()) setSettings(data);
    }, () => {
      if (isActive()) setError(new Error('Could not load settings.'));
    });

    return () => {
      sessionGuard.invalidate(scope);
      unsubReceipts();
      unsubPending();
      unsubCategories();
      unsubSettings();
    };
  }, [sessionEpoch, userId]);

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
    if (!user) throw new Error('You must be signed in to update a receipt.');
    return receiptRepository.updateReceipt(user.uid, id, data, currentVersion);
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
