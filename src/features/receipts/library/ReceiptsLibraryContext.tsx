import React, { createContext, useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { receiptRepository, categoryRepository, settingsRepository } from '../../../services/firebase/db';
import { ReceiptDocument, CategoryDocument, AppSettingsDocument, AppSettingsSchema } from '../../../domain/schema';
import { filterAndSortReceipts, FilterState, SortState } from './libraryUtils';
import { ActiveSessionGuard } from '../../../services/firebase/subscriptionIsolation';
import {
  deriveReceiptSyncState,
  FirestoreSnapshotSyncMetadata,
  ReceiptSyncState,
} from './syncState';

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
  isFiltering: boolean;
  categories: CategoryDocument[];
  settings: AppSettingsDocument;
  loading: boolean;
  error: Error | null;
  syncState: ReceiptSyncState;
  lastSyncedAt: Date | null;
  filters: FilterState;
  sort: SortState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  setSort: React.Dispatch<React.SetStateAction<SortState>>;
  deleteReceipt: (id: string) => Promise<void>;
  updateReceipt: (id: string, data: Partial<ReceiptDocument>, currentVersion?: number) => Promise<ReceiptDocument>;
}

const ReceiptsLibraryContext = createContext<ReceiptsLibraryContextType | undefined>(undefined);

const getBrowserOnlineStatus = () => typeof navigator === 'undefined' || navigator.onLine;
const initialSyncErrors = () => ({ confirmed: false, pending: false, categories: false, settings: false });

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
  const [online, setOnline] = useState(getBrowserOnlineStatus);
  const [confirmedSnapshotSync, setConfirmedSnapshotSync] = useState<FirestoreSnapshotSyncMetadata | null>(null);
  const [pendingSnapshotSync, setPendingSnapshotSync] = useState<FirestoreSnapshotSyncMetadata | null>(null);
  const [syncErrors, setSyncErrors] = useState(initialSyncErrors);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const [filters, setFilters] = useState<FilterState>(initialFilters);

  const [sort, setSort] = useState<SortState>({ field: 'date', order: 'desc' });
  const deferredSearchQuery = useDeferredValue(filters.searchQuery);

  useEffect(() => {
    const sessionGuard = sessionGuardRef.current;
    const resetState = (isLoading: boolean) => {
      setReceipts([]);
      setPendingReceipts([]);
      setCategories([]);
      setSettings(AppSettingsSchema.parse({}));
      setLoading(isLoading);
      setError(null);
      setConfirmedSnapshotSync(null);
      setPendingSnapshotSync(null);
      setSyncErrors(initialSyncErrors());
      setOnline(getBrowserOnlineStatus());
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
      if (isInitialReceiptLoad) {
        isInitialReceiptLoad = false;
        checkLoading();
      }
    }, (err) => {
      if (!isActive()) return;
      setSyncErrors(current => ({ ...current, confirmed: true }));
      setError(err);
      isInitialReceiptLoad = false;
      checkLoading();
    }, (metadata) => {
      if (!isActive()) return;
      setConfirmedSnapshotSync(metadata);
      setSyncErrors(current => ({ ...current, confirmed: false }));
      if (!metadata.fromCache && !metadata.hasPendingWrites) setLastSyncedAt(new Date());
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
      setSyncErrors(current => ({ ...current, pending: true }));
      isInitialPendingLoad = false;
      checkLoading();
    }, (metadata) => {
      if (!isActive()) return;
      setPendingSnapshotSync(metadata);
      setSyncErrors(current => ({ ...current, pending: false }));
    });

    const unsubCategories = categoryRepository.subscribeToCategories(userId, (data) => {
      if (isActive()) {
        setCategories(data);
        setSyncErrors(current => ({ ...current, categories: false }));
      }
    }, () => {
      if (isActive()) {
        setSyncErrors(current => ({ ...current, categories: true }));
        setError(new Error('Could not load categories.'));
      }
    });

    const unsubSettings = settingsRepository.subscribeToSettings(userId, data => {
      if (isActive()) {
        setSettings(data);
        setSyncErrors(current => ({ ...current, settings: false }));
      }
    }, () => {
      if (isActive()) {
        setSyncErrors(current => ({ ...current, settings: true }));
        setError(new Error('Could not load settings.'));
      }
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
    const handleOnline = () => {
      // Connectivity is only a hint. Keep the last Firestore metadata: a brief
      // browser interruption need not produce a new snapshot. Metadata events
      // will update cache/pending-write state when Firestore actually reconnects.
      setOnline(true);
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
  }, []);

  const syncState = useMemo(() => deriveReceiptSyncState({
    online,
    loading,
    hasError: Object.values(syncErrors).some(Boolean),
    sources: [confirmedSnapshotSync, pendingSnapshotSync],
  }), [confirmedSnapshotSync, loading, online, pendingSnapshotSync, syncErrors]);

  // Search can scan OCR text and every line item. Keep the controlled input
  // urgent while deferring that scan; non-search filters still apply at once.
  const deferredFilters = useMemo<FilterState>(() => ({
    searchQuery: deferredSearchQuery,
    dateStart: filters.dateStart,
    dateEnd: filters.dateEnd,
    merchant: filters.merchant,
    category: filters.category,
    item: filters.item,
    paymentMethod: filters.paymentMethod,
    amountMin: filters.amountMin,
    amountMax: filters.amountMax,
    hasWarning: filters.hasWarning,
  }), [
    deferredSearchQuery,
    filters.amountMax,
    filters.amountMin,
    filters.category,
    filters.dateEnd,
    filters.dateStart,
    filters.hasWarning,
    filters.item,
    filters.merchant,
    filters.paymentMethod,
  ]);
  const filteredReceipts = useMemo(() => {
    return filterAndSortReceipts(receipts, deferredFilters, sort);
  }, [receipts, deferredFilters, sort]);
  const isFiltering = filters.searchQuery !== deferredSearchQuery;

  const deleteReceipt = useCallback(async (id: string) => {
    if (!user) return;
    await receiptRepository.deleteReceipt(user.uid, id);
  }, [user]);

  const updateReceipt = useCallback(async (id: string, data: Partial<ReceiptDocument>, currentVersion?: number) => {
    if (!user) throw new Error('You must be signed in to update a receipt.');
    return receiptRepository.updateReceipt(user.uid, id, data, currentVersion);
  }, [user]);

  const value = useMemo<ReceiptsLibraryContextType>(() => ({
    receipts,
    pendingReceipts,
    filteredReceipts,
    isFiltering,
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
    updateReceipt,
  }), [
    categories,
    deleteReceipt,
    error,
    filteredReceipts,
    filters,
    isFiltering,
    lastSyncedAt,
    loading,
    pendingReceipts,
    receipts,
    settings,
    sort,
    syncState,
    updateReceipt,
  ]);

  return (
    <ReceiptsLibraryContext.Provider value={value}>
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
