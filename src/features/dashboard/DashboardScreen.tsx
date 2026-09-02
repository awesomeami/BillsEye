import React, { Suspense, lazy, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, Wallet, ReceiptText, Inbox, ChevronRight, AlertTriangle, TrendingUp, Tag } from 'lucide-react';
import { formatCurrency } from '../../utilities/config';
import { useReceiptsLibrary } from '../receipts/library/ReceiptsLibraryContext';
import { calculateDashboardSummary, DashboardPeriod, DashboardSummary, DateRange, DateRangeFilter, getDefaultCustomDateRange, generateSummaryInsights } from '../../domain/analytics';
import { ReceiptTotalValue } from '../../components/receipts/ReceiptTotalValue';
import { RouteLoadingState } from '../../components/ui/LoadingState';
import { DateRangeControl, DateRangeOption } from '../../components/ui/DateRangeControl';
import { useKarachiNow } from '../../hooks/useKarachiNow';
const DashboardCharts = lazy(() => import('./DashboardCharts').then(module => ({ default: module.DashboardCharts })));

const dashboardDateOptions: readonly DateRangeOption[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'current_and_previous_2_months', label: 'Last 3 Months' },
  { value: 'this_year', label: 'This Year' },
  { value: 'all_time', label: 'All Time' },
];

const dashboardPeriodLabels: Record<DashboardPeriod, string> = {
  this_month: 'This Month',
  last_month: 'Last Month',
  previous_3_months: 'Previous 3 Months',
  current_and_previous_2_months: 'Last 3 Months',
  this_year: 'This Year',
  all_time: 'All Time',
  custom: 'Custom Range',
};

const dashboardWidgetIds = [
  'total',
  'activity',
  'categories',
  'trend',
  'merchants',
  'items',
  'receipts',
] as const;

type DashboardWidgetId = typeof dashboardWidgetIds[number];

interface DashboardWidgetRangeState {
  selectedPeriod: DashboardPeriod | null;
  customRange: DateRange;
}

interface DashboardWidgetRange extends DashboardWidgetRangeState {
  period: DashboardPeriod;
  periodLabel: string;
  periodDescription: string;
  summary: DashboardSummary;
}

function createDashboardWidgetRanges(): Record<DashboardWidgetId, DashboardWidgetRangeState> {
  return Object.fromEntries(dashboardWidgetIds.map(widgetId => [
    widgetId,
    {
      selectedPeriod: null,
      customRange: getDefaultCustomDateRange(),
    },
  ])) as Record<DashboardWidgetId, DashboardWidgetRangeState>;
}

interface DashboardWidgetDateRangeControlProps {
  widgetId: DashboardWidgetId;
  label: string;
  range: DashboardWidgetRange;
  onPeriodChange: (widgetId: DashboardWidgetId, period: DashboardPeriod) => void;
  onCustomRangeChange: (widgetId: DashboardWidgetId, range: DateRange) => void;
}

function DashboardWidgetDateRangeControl({
  widgetId,
  label,
  range,
  onPeriodChange,
  onCustomRangeChange,
}: DashboardWidgetDateRangeControlProps) {
  const accessibleLabel = `${label} date range`;

  return (
    <DateRangeControl
      id={`dashboard-${widgetId}-date-range`}
      label={accessibleLabel}
      value={range.period}
      options={dashboardDateOptions}
      customRange={range.customRange}
      onChange={(value: DateRangeFilter) => onPeriodChange(widgetId, value as DashboardPeriod)}
      onCustomRangeChange={(nextRange: DateRange) => onCustomRangeChange(widgetId, nextRange)}
      className="w-full sm:w-auto sm:min-w-0"
      selectClassName="w-full sm:!w-auto sm:min-w-36"
    />
  );
}

export function DashboardScreen() {
  const { receipts, pendingReceipts, categories, loading } = useReceiptsLibrary();
  const referenceDate = useKarachiNow();
  const [widgetRangeStates, setWidgetRangeStates] = useState(createDashboardWidgetRanges);
  const allReceipts = useMemo(() => [...receipts, ...pendingReceipts], [receipts, pendingReceipts]);
  const monthSummary = useMemo(
    () => calculateDashboardSummary(allReceipts, referenceDate, categories),
    [allReceipts, categories, referenceDate],
  );
  const defaultPeriod: DashboardPeriod = monthSummary.receiptCount === 0
    && receipts.some(receipt => receipt.transactionDate)
    ? 'all_time'
    : 'this_month';
  const widgetRanges = useMemo(() => {
    const summaryCache = new Map<string, DashboardSummary>();
    summaryCache.set('this_month', monthSummary);

    return Object.fromEntries(dashboardWidgetIds.map(widgetId => {
      const state = widgetRangeStates[widgetId];
      const period = state.selectedPeriod ?? defaultPeriod;
      const cacheKey = period === 'custom'
        ? `${period}:${state.customRange.start ?? ''}:${state.customRange.end ?? ''}`
        : period;
      let summary = summaryCache.get(cacheKey);
      if (!summary) {
        summary = calculateDashboardSummary(
          allReceipts,
          referenceDate,
          categories,
          period,
          state.customRange,
        );
        summaryCache.set(cacheKey, summary);
      }
      const periodLabel = dashboardPeriodLabels[period];
      const periodDescription = period === 'all_time'
        ? 'across all dates'
        : period === 'custom'
          ? 'within the selected dates'
          : `in ${periodLabel.toLowerCase()}`;

      return [widgetId, {
        ...state,
        period,
        periodLabel,
        periodDescription,
        summary,
      }];
    })) as Record<DashboardWidgetId, DashboardWidgetRange>;
  }, [allReceipts, categories, defaultPeriod, monthSummary, referenceDate, widgetRangeStates]);
  const dataQualitySummary = useMemo(
    () => calculateDashboardSummary(allReceipts, referenceDate, categories, 'all_time'),
    [allReceipts, categories, referenceDate],
  );
  const insights = useMemo(
    () => generateSummaryInsights(receipts, referenceDate, categories),
    [receipts, categories, referenceDate],
  );

  const updateWidgetPeriod = (widgetId: DashboardWidgetId, selectedPeriod: DashboardPeriod) => {
    setWidgetRangeStates(current => ({
      ...current,
      [widgetId]: { ...current[widgetId], selectedPeriod },
    }));
  };

  const updateWidgetCustomRange = (widgetId: DashboardWidgetId, customRange: DateRange) => {
    setWidgetRangeStates(current => ({
      ...current,
      [widgetId]: { ...current[widgetId], customRange },
    }));
  };

  const {
    currentTotal,
    currentTotalAvailable,
    prevTotal,
    previousTotalAvailable,
    changeAbs,
    changePct,
  } = widgetRanges.total.summary;

  const { pendingCount } = monthSummary;
  const { needsDateCount, excludedNullCount } = dataQualitySummary;
  const totalRange = widgetRanges.total;

  const isUp = changeAbs > 0;

  if (loading) return <RouteLoadingState />;

  return (
    <div className="space-y-5">
      <header className="page-header flex-wrap">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">Your spending at a glance</p>
        </div>
        {pendingCount > 0 && (
          <Link to="/inbox" className="flex items-center gap-2 bg-red-50 text-red-700 px-3 py-1.5 rounded-full text-sm font-medium hover:bg-red-100 transition-colors">
            <Inbox size={16} />
            {pendingCount} Pending
          </Link>
        )}
      </header>

      {needsDateCount > 0 && (
        <div className="bg-amber-50 text-amber-800 p-4 rounded-xl flex items-center gap-3">
          <AlertTriangle size={20} className="text-amber-500 shrink-0" />
          <p className="text-sm">
            <strong>{needsDateCount} receipt{needsDateCount !== 1 ? 's' : ''}</strong> {needsDateCount !== 1 ? 'are' : 'is'} missing a date. They are excluded from date-based summaries. Update them in the library.
          </p>
        </div>
      )}{excludedNullCount > 0 && (
        <div className="bg-amber-50 text-amber-800 p-4 rounded-xl flex items-center gap-3">
          <AlertTriangle size={20} className="text-amber-500 shrink-0" />
          <p className="text-sm">
            <strong>{excludedNullCount} receipt{excludedNullCount !== 1 ? 's' : ''}</strong> {excludedNullCount !== 1 ? 'have' : 'has'} missing totals. They are excluded from sums and averages.
          </p>
        </div>
      )}

      {receipts.length === 0 && pendingReceipts.length === 0 ? (
        <section className="app-card overflow-hidden">
          <div className="grid min-h-80 place-items-center px-6 py-12 text-center sm:px-10">
            <div className="max-w-md">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><ReceiptText size={30} /></div>
              <h2 className="mt-5 text-xl font-bold tracking-tight text-gray-950">Your spending picture starts here</h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">Add your first receipt to build a private overview of totals, categories, merchants and daily spending.</p>
              <Link to="/add" className="btn-primary mt-6"><ReceiptText size={18} /> Add your first receipt</Link>
            </div>
          </div>
        </section>
      ) : <>

      {/* Hero Metric */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <section aria-labelledby="dashboard-total-heading" className="app-card receipt-paper p-6 sm:p-8">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-2 text-gray-500">
              <Wallet size={18} />
              <h2 id="dashboard-total-heading" className="font-medium">Total Spent ({totalRange.periodLabel})</h2>
            </div>
            <DashboardWidgetDateRangeControl
              widgetId="total"
              label="Total spent"
              range={totalRange}
              onPeriodChange={updateWidgetPeriod}
              onCustomRangeChange={updateWidgetCustomRange}
            />
          </div>
          <div className="money-display mb-4 text-5xl text-gray-950 sm:text-6xl">
            {currentTotalAvailable || totalRange.summary.receiptCount === 0 ? formatCurrency(currentTotal / 100) : 'Unavailable'}
          </div>
          <div className="flex items-center gap-2 text-sm">
            {totalRange.period !== 'this_month' ? (
              <span className="text-gray-500">Confirmed receipts {totalRange.periodDescription}</span>
            ) : totalRange.summary.receiptCount === 0 ? (
              <span className="text-gray-500">No confirmed receipts dated this month</span>
            ) : changePct !== null ? (
              <>
                <div className={`flex items-center gap-1 font-medium ${isUp ? 'text-red-600' : 'text-green-600'}`}>
                  {isUp ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                  <span>{Math.abs(changePct).toFixed(1)}%</span>
                </div>
                <span className="text-gray-500">
                  vs {formatCurrency(prevTotal / 100)} through the same day last month
                </span>
              </>
            ) : currentTotalAvailable && previousTotalAvailable ? (
              <span className="text-gray-500">No percentage comparison when the previous period is zero</span>
            ) : (
              <span className="text-gray-500">Comparable totals are unavailable</span>
            )}
          </div>
        </section>

        {/* Quick actions or secondary metric */}
        <div className="ledger-surface flex flex-col justify-between p-5 sm:p-6">
          <div>
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between lg:flex-col">
              <h3 className="font-medium text-gray-900">Recent Activity</h3>
              <DashboardWidgetDateRangeControl
                widgetId="activity"
                label="Recent activity"
                range={widgetRanges.activity}
                onPeriodChange={updateWidgetPeriod}
                onCustomRangeChange={updateWidgetCustomRange}
              />
            </div>
            <p className="text-sm text-gray-500">{widgetRanges.activity.summary.receiptCount} confirmed receipt{widgetRanges.activity.summary.receiptCount !== 1 ? 's' : ''} {widgetRanges.activity.periodDescription}.</p>
          </div>
          <Link to="/add" className="btn-outline mt-5 justify-between p-4 text-blue-700">
            <div className="flex items-center gap-3">
              <ReceiptText size={20} />
              <span className="font-medium">Add a new receipt</span>
            </div>
            <ChevronRight size={20} />
          </Link>
        </div>
      </div>

      {/* AI Insights Section */}
      {(insights.largestIncreases.length > 0 || insights.categoryChanges.length > 0) && (
        <div className="border-l-4 border-blue-600 bg-blue-50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Tag size={20} className="text-blue-600" />
            <h3 className="text-lg font-semibold text-blue-900">Monthly Insights</h3>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            
            {insights.largestIncreases.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-blue-800 mb-3 flex items-center gap-2">
                  <TrendingUp size={16} className="text-red-500" /> 
                  Largest Price Increases
                </h4>
                <ul className="space-y-3">
                  {insights.largestIncreases.map(item => (
                    <li key={item.canonicalName} className="flex justify-between items-center text-sm bg-white/60 p-2 px-3 rounded-lg">
                      <span className="font-medium text-gray-900 capitalize">{item.canonicalName}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-600">
                          {item.latestPrice == null
                            ? 'Unavailable'
                            : `${formatCurrency(item.latestPrice / 100)}/${item.standardUnit}`}
                        </span>
                        <span className="text-red-600 font-medium">+{item.priceChangePct!.toFixed(1)}%</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {insights.categoryChanges.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-blue-800 mb-3 flex items-center gap-2">
                  <Wallet size={16} className="text-blue-500" /> 
                  Category Shifts
                </h4>
                <ul className="space-y-3">
                  {insights.categoryChanges.map(cat => {
                    const isCatUp = cat.changePct > 0;
                    return (
                      <li key={cat.category} className="text-sm bg-white/60 p-2 px-3 rounded-lg">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-medium text-gray-900">{cat.category}</span>
                          <span className={`font-medium ${isCatUp ? 'text-red-600' : 'text-green-600'}`}>
                            {isCatUp ? '+' : ''}{cat.changePct.toFixed(1)}%
                          </span>
                        </div>
                        {cat.leadingItem && (
                          <div className="text-xs text-gray-500 truncate">
                            Led by spending on <span className="font-medium text-gray-700 capitalize">{cat.leadingItem}</span>
                            {cat.leadingMerchant && ` at ${cat.leadingMerchant}`}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            
          </div>
        </div>
      )}

      <Suspense fallback={<div className="grid grid-cols-1 gap-5 lg:grid-cols-2"><div className="skeleton h-80 rounded-2xl" /><div className="skeleton h-80 rounded-2xl" /></div>}>
        <DashboardCharts
          categoryComposition={widgetRanges.categories.summary.categoryComposition}
          dailyTrend={widgetRanges.trend.summary.dailyTrend}
          categoryRangeControl={(
            <DashboardWidgetDateRangeControl
              widgetId="categories"
              label="Category composition"
              range={widgetRanges.categories}
              onPeriodChange={updateWidgetPeriod}
              onCustomRangeChange={updateWidgetCustomRange}
            />
          )}
          trendRangeControl={(
            <DashboardWidgetDateRangeControl
              widgetId="trend"
              label="Daily spending trend"
              range={widgetRanges.trend}
              onPeriodChange={updateWidgetPeriod}
              onCustomRangeChange={updateWidgetCustomRange}
            />
          )}
        />
      </Suspense>

      <div className="grid grid-cols-1 gap-5 pt-2 xl:grid-cols-3">
        <div className="app-card flex flex-col p-5 sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between xl:flex-col">
            <h3 className="font-medium text-gray-900">Top Merchants</h3>
            <DashboardWidgetDateRangeControl
              widgetId="merchants"
              label="Top merchants"
              range={widgetRanges.merchants}
              onPeriodChange={updateWidgetPeriod}
              onCustomRangeChange={updateWidgetCustomRange}
            />
          </div>
          <div className="space-y-4">
            {widgetRanges.merchants.summary.topMerchants.length > 0 ? widgetRanges.merchants.summary.topMerchants.map(m => (
              <div key={m.name} className="flex justify-between items-center">
                <span className="text-gray-600 truncate mr-2">{m.name}</span>
                <span className="money-value font-medium text-gray-900">{formatCurrency(m.total / 100)}</span>
              </div>
            )) : (
              <span className="text-gray-500 text-sm">No merchant data</span>
            )}
          </div>
        </div>

        <div className="app-card flex flex-col p-5 sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between xl:flex-col">
            <h3 className="font-medium text-gray-900">Top Items</h3>
            <DashboardWidgetDateRangeControl
              widgetId="items"
              label="Top items"
              range={widgetRanges.items}
              onPeriodChange={updateWidgetPeriod}
              onCustomRangeChange={updateWidgetCustomRange}
            />
          </div>
          <div className="space-y-4">
            {widgetRanges.items.summary.topItems.length > 0 ? widgetRanges.items.summary.topItems.map(item => (
              <div key={item.name} className="flex justify-between items-center">
                <span className="text-gray-600 truncate mr-2">{item.name}</span>
                <span className="money-value font-medium text-gray-900">{formatCurrency(item.total / 100)}</span>
              </div>
            )) : (
              <span className="text-gray-500 text-sm">No item data</span>
            )}
          </div>
        </div>

        <div className="app-card flex flex-col p-5 sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between xl:flex-col">
            <h3 className="font-medium text-gray-900">Recent Receipts</h3>
            <DashboardWidgetDateRangeControl
              widgetId="receipts"
              label="Recent receipts"
              range={widgetRanges.receipts}
              onPeriodChange={updateWidgetPeriod}
              onCustomRangeChange={updateWidgetCustomRange}
            />
          </div>
          <div className="space-y-4">
            {widgetRanges.receipts.summary.recentReceipts.length > 0 ? widgetRanges.receipts.summary.recentReceipts.map(r => (
              <Link to={`/receipts?id=${r.id}`} key={r.id} className="flex justify-between items-center hover:bg-gray-50 p-2 -mx-2 rounded-lg transition-colors">
                <div className="flex flex-col min-w-0">
                  <span className="text-gray-900 font-medium truncate">{r.merchantNormalized || r.merchantRaw || 'Unknown'}</span>
                  <span className="text-gray-500 text-xs truncate">{r.transactionDate}</span>
                </div>
                <ReceiptTotalValue receipt={r} className="font-medium text-gray-900 shrink-0 ml-4" />
              </Link>
            )) : (
              <span className="text-gray-500 text-sm">No recent receipts</span>
            )}
          </div>
        </div>
      </div>
      </>}
    </div>
  );
}
