import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, Wallet, ReceiptText, Inbox, ChevronRight, AlertTriangle, TrendingUp, Tag } from 'lucide-react';
import { APP_CONFIG, formatCurrency } from '../../utilities/config';
import { useReceiptsLibrary } from '../receipts/library/ReceiptsLibraryContext';
import { calculateDashboardSummary, generateSummaryInsights } from '../../domain/analytics';
import { ReceiptTotalValue } from '../../components/receipts/ReceiptTotalValue';
import { ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6'];

const formatTrendDate = (date: string) => new Intl.DateTimeFormat(APP_CONFIG.locale, {
  timeZone: APP_CONFIG.timeZone,
  month: 'short',
  day: 'numeric',
}).format(new Date(`${date}T00:00:00+05:00`));

export function DashboardScreen() {
  const { receipts, pendingReceipts, categories } = useReceiptsLibrary();
  
  const summary = useMemo(() => calculateDashboardSummary([...receipts, ...pendingReceipts], new Date(), categories), [receipts, pendingReceipts, categories]);
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

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-end pb-4 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
          <p className="text-sm text-gray-500 mt-1">This month's snapshot</p>
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
            <strong>{needsDateCount} receipt{needsDateCount !== 1 ? 's' : ''}</strong> {needsDateCount !== 1 ? 'are' : 'is'} missing a date. They are excluded from the current month totals. Update them in the library.
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

      {/* Hero Metric */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 text-gray-500 mb-2">
            <Wallet size={18} />
            <span className="font-medium">Total Spent (This Month)</span>
          </div>
          <div className="text-4xl font-bold text-gray-900 mb-4">
            {currentTotalAvailable ? formatCurrency(currentTotal / 100) : 'Unavailable'}
          </div>
          <div className="flex items-center gap-2 text-sm">
            {changePct !== null ? (
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
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <h3 className="font-medium text-gray-900 mb-1">Recent Activity</h3>
            <p className="text-sm text-gray-500">You have added {summary.receiptCount} receipts this month.</p>
          </div>
          <Link to="/add" className="mt-4 flex items-center justify-between bg-gray-50 p-4 rounded-xl hover:bg-gray-100 transition-colors">
            <div className="flex items-center gap-3">
              <ReceiptText size={20} className="text-blue-600" />
              <span className="font-medium text-gray-900">Add a new receipt</span>
            </div>
            <ChevronRight size={20} className="text-gray-400" />
          </Link>
        </div>
      </div>

      {/* AI Insights Section */}
      {(insights.largestIncreases.length > 0 || insights.categoryChanges.length > 0) && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-2xl border border-blue-100 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Tag size={20} className="text-blue-600" />
            <h3 className="text-lg font-semibold text-blue-900">Monthly Insights</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
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

      {/* Categories & Trends */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
        {/* ... category composition and daily trend ... */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80 flex flex-col">
          <h3 className="font-medium text-gray-900 mb-4">Category Composition</h3>
          {categoryComposition.length > 0 ? (
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryComposition}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="total"
                    nameKey="name"
                  >
                    {categoryComposition.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => formatCurrency(value / 100)}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
             <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
               No categories this month.
             </div>
          )}
        </div>
        
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80 flex flex-col">
          <h3 className="font-medium text-gray-900 mb-4">Daily Spending Trend</h3>
          {dailyTrend.length > 0 ? (
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={formatTrendDate}
                    stroke="#9ca3af"
                    fontSize={12}
                    tickMargin={10}
                  />
                  <YAxis 
                    tickFormatter={(val: number) => formatCurrency(val / 100)}
                    stroke="#9ca3af"
                    fontSize={12}
                    width={50}
                  />
                  <Tooltip 
                    formatter={(value: number) => formatCurrency(value / 100)}
                    labelFormatter={(label) => `Date: ${formatTrendDate(String(label))}`}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Line type="monotone" dataKey="total" stroke="#10b981" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
               No spending data this month.
             </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-4">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
          <h3 className="font-medium text-gray-900 mb-4">Top Merchants</h3>
          <div className="space-y-4">
            {summary.topMerchants.length > 0 ? summary.topMerchants.map(m => (
              <div key={m.name} className="flex justify-between items-center">
                <span className="text-gray-600 truncate mr-2">{m.name}</span>
                <span className="font-medium text-gray-900">{formatCurrency(m.total / 100)}</span>
              </div>
            )) : (
              <span className="text-gray-500 text-sm">No merchant data</span>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
          <h3 className="font-medium text-gray-900 mb-4">Top Items</h3>
          <div className="space-y-4">
            {summary.topItems.length > 0 ? summary.topItems.map(item => (
              <div key={item.name} className="flex justify-between items-center">
                <span className="text-gray-600 truncate mr-2">{item.name}</span>
                <span className="font-medium text-gray-900">{formatCurrency(item.total / 100)}</span>
              </div>
            )) : (
              <span className="text-gray-500 text-sm">No item data</span>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
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
    </div>
  );
}
