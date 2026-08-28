import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDate } from '../../utilities/config';
const safeParseMajorToMinor = (val: string) => {
    try {
      return val ? parseMajorToMinor(val) : null;
    } catch {
      return null;
    }
  };
import { parseMajorToMinor } from '../../domain/money';
import { 
  Search, Filter, ReceiptText, AlertTriangle,
  ChevronDown, ChevronUp, Edit2, CheckCircle2, Clock
} from 'lucide-react';
import { cn } from '../../utilities/cn';
import { useReceiptsLibrary } from './library/ReceiptsLibraryContext';
import { ReceiptDocument } from '../../domain/schema';
import { ReceiptDetailModal } from './library/ReceiptDetailModal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { getReceiptItemCategoryLabel } from '../../domain/categories';
import { useClientSessionActionGuard } from '../auth/useClientSessionActionGuard';
import { ReceiptTotalValue } from '../../components/receipts/ReceiptTotalValue';

const RECEIPTS_PAGE_SIZE = 50;

export function ReceiptsListScreen() {
  const sessionActions = useClientSessionActionGuard();
  const { 
    filteredReceipts,
    isFiltering,
    receipts,
    loading, 
    error, 
    syncState, 
    lastSyncedAt, 
    filters, 
    setFilters, 
    sort, 
    setSort,
    deleteReceipt,
    categories: categoryDefinitions,
  } = useReceiptsLibrary();

  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();

  const [showFilters, setShowFilters] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptDocument | null>(null);
  const [receiptToDelete, setReceiptToDelete] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(RECEIPTS_PAGE_SIZE);
  const visibleReceipts = useMemo(
    () => filteredReceipts.slice(0, visibleCount),
    [filteredReceipts, visibleCount],
  );

  useEffect(() => {
    setVisibleCount(RECEIPTS_PAGE_SIZE);
  }, [filteredReceipts]);

  useEffect(() => {
    if (loading) return;
    
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    if (category || search) {
      setFilters(current => {
        const next = {
          ...current,
          ...(category ? { category } : {}),
          ...(search ? { searchQuery: search } : {}),
        };
        return next.category === current.category && next.searchQuery === current.searchQuery
          ? current
          : next;
      });
      setShowFilters(true);
    }
    
    const id = searchParams.get('id');
    if (id) {
      const receipt = receipts.find(r => r.id === id);
      if (receipt) {
        setSelectedReceipt(receipt);
      }
    }
  }, [loading, searchParams, receipts, setFilters]);

  const closeReceiptModal = () => {
    setSelectedReceipt(null);
    if (searchParams.has('id')) {
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('id');
      setSearchParams(newParams, { replace: true });
    }
  };

  const handleDelete = async () => {
    const id = receiptToDelete;
    if (!id) return;
    const scope = sessionActions.capture();
    if (!scope) return;

    try {
      await deleteReceipt(id);
      if (!sessionActions.isActive(scope)) return;
      if (selectedReceipt?.id === id) closeReceiptModal();
      showToast('Receipt deleted.', 'success');
    } catch {
      if (!sessionActions.isActive(scope)) return;
      console.error('Failed to delete receipt.');
      showToast('Could not delete this receipt. Please try again.', 'error');
    } finally {
      if (sessionActions.isActive(scope)) setReceiptToDelete(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-700 rounded-lg">
        Error loading receipts: {error.message}
      </div>
    );
  }

  const handleSortChange = (field: 'date' | 'total' | 'merchant') => {
    setSort(prev => ({
      field,
      order: prev.field === field ? (prev.order === 'asc' ? 'desc' : 'asc') : 'desc'
    }));
  };

  return (
    <div className="space-y-6">
      <header className="pb-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Receipts</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-gray-500">Manage and search your confirmed expenses.</p>
            <span className={cn("text-xs flex items-center gap-1", 
              syncState === 'synced' ? 'text-green-600' :
              syncState === 'offline' ? 'text-yellow-600' :
              syncState === 'pending-writes' ? 'text-amber-600' :
              syncState === 'error' ? 'text-red-600' : 'text-blue-600'
            )}>
              {syncState === 'synced' && <CheckCircle2 size={12} />}
              {syncState === 'offline' && <AlertTriangle size={12} />}
              {syncState === 'pending-writes' && <Clock size={12} className="animate-spin" />}
              {syncState === 'error' && <AlertTriangle size={12} />}
              {syncState === 'syncing' && <Clock size={12} className="animate-spin" />}
              {syncState === 'synced' && lastSyncedAt
                ? `Synced ${lastSyncedAt.toLocaleTimeString()}`
                : syncState === 'pending-writes'
                  ? 'Changes pending sync'
                  : syncState}
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={18} className="text-gray-400" />
            </div>
            <label htmlFor="receipt-search" className="sr-only">Search receipts</label>
            <input
              id="receipt-search"
              type="text"
              className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-xl leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder="Search merchant, items, notes..."
              value={filters.searchQuery}
              aria-describedby="receipt-search-status"
              aria-busy={isFiltering}
              onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
            />
            <span id="receipt-search-status" className="sr-only" aria-live="polite">
              {isFiltering ? 'Updating receipt results' : `${filteredReceipts.length} receipt results`}
            </span>
          </div>
            <button
            onClick={() => setShowFilters(!showFilters)}
            aria-label={showFilters ? 'Hide receipt filters' : 'Show receipt filters'}
            aria-controls="receipt-filters"
            aria-expanded={showFilters}
            className={cn("touch-target flex items-center justify-center p-2.5 rounded-xl border transition-colors",
              showFilters ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-gray-100 text-gray-700 border-transparent hover:bg-gray-200"
            )}
          >
            <Filter size={20} />
          </button>
        </div>

        {showFilters && (
          <div id="receipt-filters" aria-label="Receipt filters" className="p-4 bg-gray-50 border border-gray-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor="filter-date-start" className="block text-xs font-medium text-gray-700 mb-1">Date Range Start</label>
              <input id="filter-date-start" type="date" className="w-full border-gray-300 rounded-md text-sm p-1.5"
                value={filters.dateStart || ''} onChange={e => setFilters(prev => ({...prev, dateStart: e.target.value || null}))} />
            </div>
            <div>
              <label htmlFor="filter-date-end" className="block text-xs font-medium text-gray-700 mb-1">Date Range End</label>
              <input id="filter-date-end" type="date" className="w-full border-gray-300 rounded-md text-sm p-1.5"
                value={filters.dateEnd || ''} onChange={e => setFilters(prev => ({...prev, dateEnd: e.target.value || null}))} />
            </div>
            <div>
              <label htmlFor="filter-amount-min" className="block text-xs font-medium text-gray-700 mb-1">Amount Min</label>
              <input id="filter-amount-min" type="text" className="w-full border-gray-300 rounded-md text-sm p-1.5" placeholder="0.00"
                value={filters.amountMin !== null ? (filters.amountMin / 100).toString() : ''} onChange={e => setFilters(prev => ({...prev, amountMin: safeParseMajorToMinor(e.target.value)}))} />
            </div>
            <div>
              <label htmlFor="filter-amount-max" className="block text-xs font-medium text-gray-700 mb-1">Amount Max</label>
              <input id="filter-amount-max" type="text" className="w-full border-gray-300 rounded-md text-sm p-1.5" placeholder="0.00"
                value={filters.amountMax !== null ? (filters.amountMax / 100).toString() : ''} onChange={e => setFilters(prev => ({...prev, amountMax: safeParseMajorToMinor(e.target.value)}))} />
            </div>
            <div className="col-span-1 sm:col-span-2 lg:col-span-4 flex gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={filters.hasWarning === true} 
                  onChange={e => setFilters(prev => ({...prev, hasWarning: e.target.checked ? true : null}))} />
                Has Warnings/Discrepancy
              </label>
              <button 
                onClick={() => setFilters({searchQuery: '', dateStart: null, dateEnd: null, merchant: null, category: null, item: null, paymentMethod: null, amountMin: null, amountMax: null, hasWarning: null})}
                className="touch-target text-sm text-blue-700 hover:underline"
              >
                Clear Filters
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Desktop Table Header */}
        <div role="row" className="hidden sm:grid grid-cols-12 gap-4 p-4 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <div role="columnheader" aria-sort={sort.field === 'date' ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'} className="col-span-3">
            <button type="button" onClick={() => handleSortChange('date')} className="touch-target flex items-center gap-1 hover:text-gray-700" aria-label={`Sort by date, currently ${sort.field === 'date' ? sort.order === 'asc' ? 'ascending' : 'descending' : 'not sorted'}`}>
              Date {sort.field === 'date' && (sort.order === 'asc' ? <ChevronUp aria-hidden="true" size={14}/> : <ChevronDown aria-hidden="true" size={14}/>)}
            </button>
          </div>
          <div role="columnheader" aria-sort={sort.field === 'merchant' ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'} className="col-span-4">
            <button type="button" onClick={() => handleSortChange('merchant')} className="touch-target flex items-center gap-1 hover:text-gray-700" aria-label={`Sort by merchant, currently ${sort.field === 'merchant' ? sort.order === 'asc' ? 'ascending' : 'descending' : 'not sorted'}`}>
              Merchant {sort.field === 'merchant' && (sort.order === 'asc' ? <ChevronUp aria-hidden="true" size={14}/> : <ChevronDown aria-hidden="true" size={14}/>)}
            </button>
          </div>
          <div role="columnheader" className="col-span-2 self-center">Categories</div>
          <div role="columnheader" aria-sort={sort.field === 'total' ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'} className="col-span-3 flex justify-end">
            <button type="button" onClick={() => handleSortChange('total')} className="touch-target flex items-center justify-end gap-1 hover:text-gray-700" aria-label={`Sort by total, currently ${sort.field === 'total' ? sort.order === 'asc' ? 'ascending' : 'descending' : 'not sorted'}`}>
              Total {sort.field === 'total' && (sort.order === 'asc' ? <ChevronUp aria-hidden="true" size={14}/> : <ChevronDown aria-hidden="true" size={14}/>)}
            </button>
          </div>
        </div>

        {filteredReceipts.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <ReceiptText size={48} className="mx-auto text-gray-300 mb-3" />
            <p>No receipts found.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {visibleReceipts.map((receipt) => {
              const hasWarning = receipt.warnings.length > 0 || receipt.ambiguousFields.length > 0 || receipt.reconciliationStatus === 'mismatched';
              const categories = Array.from(new Set(
                receipt.items
                  .filter(item => item.categoryId || item.category)
                  .map(item => getReceiptItemCategoryLabel(item, categoryDefinitions)),
              ));

              return (
                <li key={receipt.id} className="render-lazy border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors group">
    <button onClick={() => setSelectedReceipt(receipt)} aria-label={`View details for ${receipt.merchantNormalized || receipt.merchantRaw || 'Unknown Merchant'}`} className="w-full text-left p-4 sm:px-4 focus:outline-none focus:bg-gray-50 focus:ring-2 focus:ring-inset focus:ring-blue-500">
      
                  {/* Mobile View */}
                  <div className="sm:hidden flex flex-col gap-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-bold text-gray-900 flex items-center gap-1">
                          {receipt.merchantNormalized || receipt.merchantRaw || 'Unknown Merchant'}
                          {receipt.wasEditedByUser && <Edit2 size={12} className="text-gray-400" />}
                        </p>
                        <p className="text-xs text-gray-500">{formatDate(receipt.transactionDate || '')}</p>
                      </div>
                      <div className="text-right flex flex-col items-end gap-1">
                        <ReceiptTotalValue receipt={receipt} className="text-sm font-bold text-gray-900" />
                        {hasWarning && <AlertTriangle size={14} className="text-amber-500" />}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {categories.slice(0, 3).map(cat => (
                        <span key={cat} className="text-[10px] font-medium text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">{cat}</span>
                      ))}
                    </div>
                  </div>

                  {/* Desktop View */}
                  <div className="hidden sm:grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-3 flex flex-col">
                      <span className="text-sm text-gray-900">{formatDate(receipt.transactionDate || '')}</span>
                      <span className="text-xs text-gray-500">{receipt.paymentMethod}</span>
                    </div>
                    <div className="col-span-4 flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900">
                        {receipt.merchantNormalized || receipt.merchantRaw || 'Unknown Merchant'}
                      </p>
                      {receipt.wasEditedByUser && (
                        <div title="Edited">
                          <Edit2 size={12} className="text-gray-400" />
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 flex flex-wrap gap-1">
                      {categories.slice(0, 2).map(cat => (
                        <span key={cat} className="text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-full">
                          {cat}
                        </span>
                      ))}
                      {categories.length > 2 && <span className="text-xs text-gray-400">+{categories.length - 2}</span>}
                    </div>
                    <div className="col-span-3 text-right flex items-center justify-end gap-3">
                      <div className="flex flex-col items-end">
                        <ReceiptTotalValue receipt={receipt} className="text-sm font-bold text-gray-900" />
                        <span className="text-xs text-gray-500">{receipt.items.length} items</span>
                      </div>
                      {hasWarning && (
                        <div title="Warnings/Mismatches">
                          <AlertTriangle size={16} className="text-amber-500" />
                        </div>
                      )}
                    </div>
                  </div>
                
    </button>
  </li>
              );
            })}
          </ul>
        )}
        {visibleCount < filteredReceipts.length && (
          <div className="border-t border-gray-200 bg-gray-50 p-3 text-center">
            <p className="mb-2 text-sm text-gray-600" aria-live="polite">
              Showing {visibleReceipts.length} of {filteredReceipts.length} receipts
            </p>
            <button
              type="button"
              className="touch-target rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
              onClick={() => setVisibleCount(current => current + RECEIPTS_PAGE_SIZE)}
            >
              Show 50 more receipts
            </button>
          </div>
        )}
      </div>

      {selectedReceipt && (
        <ReceiptDetailModal 
          receipt={selectedReceipt} 
          onClose={closeReceiptModal}
          onDelete={() => setReceiptToDelete(selectedReceipt.id)}
        />
      )}
      {receiptToDelete && (
        <ConfirmDialog
          isOpen={true}
          title="Delete Receipt"
          message="Are you sure you want to delete this receipt? This cannot be undone."
          confirmText="Delete"
          isDestructive={true}
          onConfirm={handleDelete}
          onCancel={() => setReceiptToDelete(null)}
        />
      )}
    </div>
  );
}

