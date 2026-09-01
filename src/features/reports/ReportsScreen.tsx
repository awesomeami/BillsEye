import React, { useState, useMemo, Suspense, lazy } from 'react';
import { Calendar, Tags, Store, ShoppingBag, Loader2 } from 'lucide-react';
import { cn } from '../../utilities/cn';
import { useReceiptsLibrary } from '../receipts/library/ReceiptsLibraryContext';
import { DateRange, DateRangeFilter, getDateRange, getDefaultCustomDateRange, getFilteredReceipts } from '../../domain/analytics';
import { RouteLoadingState } from '../../components/ui/LoadingState';
import { DateRangeControl, DateRangeOption } from '../../components/ui/DateRangeControl';

const MonthlyReportView = lazy(() => import('./views/MonthlyReportView').then(m => ({ default: m.MonthlyReportView })));
const CategoryReportView = lazy(() => import('./views/CategoryReportView').then(m => ({ default: m.CategoryReportView })));
const MerchantReportView = lazy(() => import('./views/MerchantReportView').then(m => ({ default: m.MerchantReportView })));
const ItemReportView = lazy(() => import('./views/ItemReportView').then(m => ({ default: m.ItemReportView })));

type Tab = 'monthly' | 'categories' | 'merchants' | 'items';

const tabs = [
  { id: 'monthly', label: 'Monthly', icon: Calendar },
  { id: 'categories', label: 'Categories', icon: Tags },
  { id: 'merchants', label: 'Merchants', icon: Store },
  { id: 'items', label: 'Items', icon: ShoppingBag },
] as const;

const reportDateOptions: readonly DateRangeOption[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'current_and_previous_2_months', label: 'Last 3 Months' },
  { value: 'this_year', label: 'This Year' },
  { value: 'all_time', label: 'All Time' },
];

export function ReportsScreen() {
  const tabsRef = React.useRef<(HTMLButtonElement | null)[]>([]);
  const { receipts, categories, loading } = useReceiptsLibrary();
  const [activeTab, setActiveTab] = useState<Tab>('monthly');
  const [selectedDateFilter, setDateFilter] = useState<DateRangeFilter | null>(null);
  const [customRange, setCustomRange] = useState<DateRange>(() => getDefaultCustomDateRange());
  const defaultDateFilter = useMemo(() => receipts.some(receipt => receipt.transactionDate)
    && getFilteredReceipts(receipts, getDateRange('this_year')).length === 0 ? 'all_time' : 'this_year', [receipts]);
  const dateFilter = selectedDateFilter ?? defaultDateFilter;

  const range = useMemo(() => dateFilter === 'custom' ? customRange : getDateRange(dateFilter), [customRange, dateFilter]);

  React.useEffect(() => {
    const activeIndex = tabs.findIndex(tab => tab.id === activeTab);
    tabsRef.current[activeIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeTab]);

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

  if (loading) return <RouteLoadingState />;

  return (
    <div className="space-y-5">
      <header className="page-header flex-col items-start sm:flex-row sm:items-end">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Detailed breakdown and insights of your spending.</p>
        </div>
        <DateRangeControl
          id="report-date-range"
          label="Report date range"
          value={dateFilter}
          options={reportDateOptions}
          customRange={customRange}
          onChange={setDateFilter}
          onCustomRangeChange={setCustomRange}
          className="w-full sm:w-auto"
          selectClassName="sm:!w-48"
        />
      </header>

      {selectedDateFilter === null && dateFilter === 'all_time' && (
        <p className="text-sm text-gray-500">Your saved receipts are dated outside this year, so all-time reports are shown.</p>
      )}

      {/* Tabs */}
      <div className="relative">
        <div role="tablist" aria-label="Report Views" className="no-scrollbar flex snap-x space-x-2 overflow-x-auto pb-2 pr-10">
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
                "touch-target snap-start flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium",
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
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-end bg-gradient-to-l from-[#f7f8fb] via-[#f7f8fb]/90 to-transparent text-lg text-gray-500 lg:hidden">›</div>
      </div>
      <p className="-mt-3 text-xs text-gray-500 lg:hidden">Swipe to see all report views</p>

      <div className="pt-2" role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} tabIndex={0}>
        <Suspense fallback={<div className="flex justify-center p-12"><Loader2 className="animate-spin text-blue-600" /></div>}>
          {renderContent()}
        </Suspense>
      </div>
    </div>
  );
}
