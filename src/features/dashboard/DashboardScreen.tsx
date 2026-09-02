import React, { Suspense, lazy, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, Wallet, ReceiptText, Inbox, ChevronRight, AlertTriangle, TrendingUp, Tag } from 'lucide-react';
import { formatCurrency } from '../../utilities/config';
import { useReceiptsLibrary } from '../receipts/library/ReceiptsLibraryContext';
import { calculateDashboardSummary, DashboardPeriod, DateRange, getDefaultCustomDateRange, generateSummaryInsights } from '../../domain/analytics';
import { ReceiptTotalValue } from '../../components/receipts/ReceiptTotalValue';
import { RouteLoadingState } from '../../components/ui/LoadingState';
import { DateRangeControl, DateRangeOption } from '../../components/ui/DateRangeControl';
const DashboardCharts = lazy(() => import('./DashboardCharts').then(module => ({ default: module.DashboardCharts })));

const dashboardDateOptions: readonly DateRangeOption[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'all_time', label: 'All Time' },
];

export function DashboardScreen() {
  const { receipts, pendingReceipts, categories, loading } = useReceiptsLibrary();
  const [selectedPeriod, setSelectedPeriod] = useState<DashboardPeriod | null>(null);
  const [customRange, setCustomRange] = useState<DateRange>(() => getDefaultCustomDateRange());
  const monthSummary = useMemo(() => calculateDashboardSummary([...receipts, ...pendingReceipts], new Date(), categories), [receipts, pendingReceipts, categories]);
  const period = selectedPeriod ?? (monthSummary.receiptCount === 0 && receipts.some(receipt => receipt.transactionDate) ? 'all_time' : 'this_month');
  const isAllTime = period === 'all_time';
  const isCustom = period === 'custom';
  const periodLabel = isAllTime ? 'All Time' : isCustom ? 'Custom Range' : 'This Month';
  const summary = useMemo(() => period === 'this_month'
    ? monthSummary
    : calculateDashboardSummary([...receipts, ...pendingReceipts], new Date(), categories, period, customRange),
  [categories, customRange, monthSummary, pendingReceipts, period, receipts]);
  const insights = useMemo(() => generateSummaryInsights(receipts, new Date(), categories), [receipts, categories]);

  const {
    currentTotal,
    currentTotalAvailable,
    prevTotal,
    previousTotalAvailable,
    changeAbs,
    changePct,
    pendingCount,
    categoryComposition,
    dailyTrend,
    needsDateCount,
    excludedNullCount
  } = summary;

  const isUp = changeAbs > 0;

  if (loading) return <RouteLoadingState />;

  return (
    <div className="space-y-5">
      <header className="page-header flex-wrap">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">{isAllTime ? 'All-time snapshot' : isCustom ? 'Snapshot for your selected dates' : "This month's snapshot"}</p>
        </div>
        <DateRangeControl
          id="dashboard-date-range"
          label="Dashboard date range"
          value={period}
          options={dashboardDateOptions}
          customRange={customRange}
          onChange={value => setSelectedPeriod(value as DashboardPeriod)}
          onCustomRangeChange={setCustomRange}
          className="w-full sm:w-auto"
          selectClassName="sm:!w-auto sm:min-w-36"
        />
        {pendingCount > 0 && (
          <Link to="/inbox" className="flex items-center gap-2 bg-red-50 text-red-700 px-3 py-1.5 rounded-full text-sm font-medium hover:bg-red-100 transition-colors">
            <Inbox size={16} />
            {pendingCount} Pending
          </Link>
        )}
      </header>

      {selectedPeriod === null && isAllTime && (
        <p className="text-sm text-gray-500">Your saved receipts are dated outside this month, so all-time statistics are shown. Spending uses the receipt date, not the upload date.</p>
      )}

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
        <div className="app-card receipt-paper p-6 sm:p-8">
          <div className="flex items-center gap-2 text-gray-500 mb-2">
            <Wallet size={18} />
            <span className="font-medium">Total Spent ({periodLabel})</span>
          </div>
          <div className="money-display mb-4 text-5xl text-gray-950 sm:text-6xl">
            {currentTotalAvailable || summary.receiptCount === 0 ? formatCurrency(currentTotal / 100) : 'Unavailable'}
          </div>
          <div className="flex items-center gap-2 text-sm">
            {period !== 'this_month' ? (
              <span className="text-gray-500">{isAllTime ? 'All confirmed receipts with a transaction date' : 'Confirmed receipts within the selected dates'}</span>
            ) : summary.receiptCount === 0 ? (
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
        </div>

        {/* Quick actions or secondary metric */}
        <div className="ledger-surface flex flex-col justify-between p-5 sm:p-6">
          <div>
            <h3 className="font-medium text-gray-900 mb-1">Recent Activity</h3>
            <p className="text-sm text-gray-500">{summary.receiptCount} confirmed receipt{summary.receiptCount !== 1 ? 's' : ''} {isAllTime ? 'across all dates' : isCustom ? 'within the selected dates' : 'dated this month'}.</p>
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
      {period === 'this_month' && (insights.largestIncreases.length > 0 || insights.categoryChanges.length > 0) && (
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
                        <span className="text-gray-600">{formatCurrency(item.latestPrice / 100)}/{item.standardUnit}</span>
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
        <DashboardCharts categoryComposition={categoryComposition} dailyTrend={dailyTrend} />
      </Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 pt-2">
        <div className="app-card flex flex-col p-5 sm:p-6">
          <h3 className="font-medium text-gray-900 mb-4">Top Merchants</h3>
          <div className="space-y-4">
            {summary.topMerchants.length > 0 ? summary.topMerchants.map(m => (
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
          <h3 className="font-medium text-gray-900 mb-4">Top Items</h3>
          <div className="space-y-4">
            {summary.topItems.length > 0 ? summary.topItems.map(item => (
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
          <h3 className="font-medium text-gray-900 mb-4">Recent Receipts</h3>
          <div className="space-y-4">
            {summary.recentReceipts.length > 0 ? summary.recentReceipts.map(r => (
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
