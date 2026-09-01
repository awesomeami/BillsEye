import React, { useState, useMemo, Suspense, lazy } from 'react';
import { Calendar, Tags, Store, ShoppingBag, Loader2 } from 'lucide-react';
import { cn } from '../../utilities/cn';
import { useReceiptsLibrary } from '../receipts/library/ReceiptsLibraryContext';
import { DateRangeFilter, getDateRange, getFilteredReceipts } from '../../domain/analytics';

const MonthlyReportView = lazy(() => import('./views/MonthlyReportView').then(m => ({ default: m.MonthlyReportView })));
const CategoryReportView = lazy(() => import('./views/CategoryReportView').then(m => ({ default: m.CategoryReportView })));
const MerchantReportView = lazy(() => import('./views/MerchantReportView').then(m => ({ default: m.MerchantReportView })));
const ItemReportView = lazy(() => import('./views/ItemReportView').then(m => ({ default: m.ItemReportView })));

type Tab = 'monthly' | 'categories' | 'merchants' | 'items';

export function ReportsScreen() {
  const tabsRef = React.useRef<(HTMLButtonElement | null)[]>([]);
  const { receipts, categories } = useReceiptsLibrary();
  const [activeTab, setActiveTab] = useState<Tab>('monthly');
  const [selectedDateFilter, setDateFilter] = useState<DateRangeFilter | null>(null);
  const defaultDateFilter = useMemo(() => receipts.some(receipt => receipt.transactionDate)
    && getFilteredReceipts(receipts, getDateRange('this_year')).length === 0 ? 'all_time' : 'this_year', [receipts]);
  const dateFilter = selectedDateFilter ?? defaultDateFilter;

  const range = useMemo(() => getDateRange(dateFilter), [dateFilter]);

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = index;
    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else {
      return;
    }
    e.preventDefault();
    tabsRef.current[nextIndex]?.focus();
    setActiveTab(tabs[nextIndex].id as Tab);
  };
  const tabs = [
    { id: 'monthly', label: 'Monthly', icon: Calendar },
    { id: 'categories', label: 'Categories', icon: Tags },
    { id: 'merchants', label: 'Merchants', icon: Store },
    { id: 'items', label: 'Items', icon: ShoppingBag },
  ] as const;

  const renderContent = () => {
    switch (activeTab) {
      case 'monthly':
        return <MonthlyReportView receipts={receipts} range={range} />;
      case 'categories':
        return <CategoryReportView receipts={receipts} categories={categories} range={range} />;
      case 'merchants':
        return <MerchantReportView receipts={receipts} range={range} />;
      case 'items':
        return <ItemReportView receipts={receipts} range={range} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-5">
      <header className="pb-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Detailed breakdown and insights of your spending.</p>
        </div>
        <label htmlFor="report-date-range" className="sr-only">Report date range</label>
        <select
          id="report-date-range"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as DateRangeFilter)}
          className="touch-target bg-white border border-gray-200 text-gray-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 shadow-sm"
        >
          <option value="this_month">This Month</option>
          <option value="last_month">Last Month</option>
          <option value="current_and_previous_2_months">Last 3 Months</option>
          <option value="this_year">This Year</option>
          <option value="all_time">All Time</option>
        </select>
      </header>

      {selectedDateFilter === null && dateFilter === 'all_time' && (
        <p className="text-sm text-gray-500">Your saved receipts are dated outside this year, so all-time reports are shown.</p>
      )}

      {/* Tabs */}
      <div className="relative">
        <div role="tablist" aria-label="Report Views" className="flex space-x-2 overflow-x-auto pb-2 pr-10 scrollbar-hide">
          {tabs.map((tab, index) => {
          
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          
          return (
            <button
              key={tab.id}
              ref={el => { tabsRef.current[index] = el; }}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              id={`tab-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onKeyDown={(e) => handleKeyDown(e, index)}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={cn(
                "touch-target flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
                isActive
                  ? "bg-gray-900 text-white"
                  : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
              )}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
          })}
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-end bg-gradient-to-l from-gray-50 via-gray-50/90 to-transparent text-lg text-gray-400 md:hidden">›</div>
      </div>
      <p className="-mt-3 text-xs text-gray-500 md:hidden">Swipe to see all report views</p>

      <div className="pt-2" role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} tabIndex={0}>
        <Suspense fallback={<div className="flex justify-center p-12"><Loader2 className="animate-spin text-blue-600" /></div>}>
          {renderContent()}
        </Suspense>
      </div>
    </div>
  );
}
