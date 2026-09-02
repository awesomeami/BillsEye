import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { generateItemReport } from '../../../domain/analytics';
import { ReceiptDocument } from '../../../domain/schema';
import { formatCurrency } from '../../../utilities/config';
import { DateRange } from '../../../domain/analytics';
import { ItemObservation } from '../../../domain/items';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react';
import { SortableTableHeader } from '../../../components/ui/SortableTableHeader';
import { getNextReportSort, ReportSortState, sortReportRows } from '../reportSorting';

interface Props {
  receipts: ReceiptDocument[];
  range: DateRange;
}

type ItemSortField = 'canonicalName' | 'totalSpent' | 'latestPrice' | 'priceChangePct' | 'occasions';

export function ItemReportView({ receipts, range }: Props) {
  const data = useMemo(() => generateItemReport(receipts, range), [receipts, range]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sort, setSort] = useState<ReportSortState<ItemSortField> | null>(null);
  const sortedData = useMemo(() => sortReportRows(data, sort, (row, field) => row[field]), [data, sort]);
  const handleSort = (field: ItemSortField, initialDirection: 'asc' | 'desc') => {
    setSort(current => getNextReportSort(current, field, initialDirection));
  };

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
        <p>No comparable item data available for the selected period.</p>
        <p className="text-sm mt-2">Make sure items have quantity and unit data to analyze unit prices.</p>
      </div>
    );
  }

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  return (
    <div className="space-y-6">
      <div className="app-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[58rem] text-left text-sm">
            <caption className="sr-only">Item price and spending summary. Activate an item row to show its details.</caption>
            <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
              <tr>
                <SortableTableHeader label="Canonical Item" active={sort?.field === 'canonicalName'} direction={sort?.direction ?? 'asc'} initialDirection="asc" onSort={() => handleSort('canonicalName', 'asc')} />
                <SortableTableHeader label="Total Spent" active={sort?.field === 'totalSpent'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('totalSpent', 'desc')} align="right" />
                <SortableTableHeader label="Unit Price (Latest)" active={sort?.field === 'latestPrice'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('latestPrice', 'desc')} align="right" />
                <SortableTableHeader label="Change" active={sort?.field === 'priceChangePct'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('priceChangePct', 'desc')} align="right" />
                <SortableTableHeader label="Occasions" active={sort?.field === 'occasions'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('occasions', 'desc')} align="right" />
                <th scope="col" aria-label="Item details" className="px-4 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedData.map((row) => {
                const rowId = `${row.canonicalName}-${row.unitCategory}`;
                const isExpanded = expandedId === rowId;
                const hasChange = row.priceChangePct !== null;
                const isUp = hasChange && row.priceChangePct! > 0;
                const isDown = hasChange && row.priceChangePct! < 0;

                return (
                  <React.Fragment key={rowId}>
                    <tr
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      aria-controls={`item-details-${rowId}`}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${row.canonicalName}`}
                      className={`hover:bg-gray-50 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-3 focus-visible:outline-blue-600 focus-visible:outline-offset-[-3px] ${isExpanded ? 'bg-gray-50' : ''}`}
                      onClick={() => toggleExpand(rowId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleExpand(rowId);
                        }
                      }}
                    >
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900 capitalize">{row.canonicalName}</div>
                        <div className="text-xs text-gray-500">Unit: {row.standardUnit}</div>
                      </td>
                      <td className="money-value px-6 py-4 text-right font-medium">{formatCurrency(row.totalSpent / 100)}</td>
                      <td className="money-value px-6 py-4 text-right">{formatCurrency(row.latestPrice / 100)} / {row.standardUnit}</td>
                      <td className="px-6 py-4 text-right">
                        {hasChange ? (
                          <div className={`inline-flex items-center gap-1 ${isUp ? 'text-red-600' : isDown ? 'text-green-600' : 'text-gray-500'}`}>
                            {isUp ? <TrendingUp size={14} /> : isDown ? <TrendingDown size={14} /> : <Minus size={14} />}
                            <span>{Math.abs(row.priceChangePct!).toFixed(1)}%</span>
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right text-gray-600">{row.occasions}</td>
                      <td className="px-4 py-4 text-right">
                        {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                      </td>
                    </tr>
                    
                    {isExpanded && (
                      <tr>
                        <td id={`item-details-${rowId}`} colSpan={6} className="p-0 border-b border-gray-100">
                          <div className="bg-gray-50 px-6 py-6 border-l-4 border-blue-500">
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                              {/* Price Metrics */}
                              <div>
                                <h4 className="font-medium text-gray-900 mb-4">Price Metrics (per {row.standardUnit})</h4>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                  <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                                    <div className="text-gray-500 text-xs mb-1">Simple Average</div>
                                    <div className="font-medium">{formatCurrency(row.simpleAverage / 100)}</div>
                                  </div>
                                  <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                                    <div className="text-gray-500 text-xs mb-1">Weighted Average</div>
                                    <div className="font-medium">{formatCurrency(row.weightedAverage / 100)}</div>
                                  </div>
                                  <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                                    <div className="text-gray-500 text-xs mb-1">Median Price</div>
                                    <div className="font-medium">{formatCurrency(row.medianPrice / 100)}</div>
                                  </div>
                                  <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                                    <div className="text-gray-500 text-xs mb-1">Min / Max Range</div>
                                    <div className="font-medium">{formatCurrency(row.minPrice / 100)} - {formatCurrency(row.maxPrice / 100)}</div>
                                  </div>
                                </div>
                              </div>

                              {/* Merchant Comparison */}
                              <div>
                                <h4 className="font-medium text-gray-900 mb-4">Merchant Averages</h4>
                                <div className="space-y-2">
                                  {row.merchants.map(m => (
                                    <div key={m.name} className="flex justify-between items-center bg-white p-2 px-3 rounded-lg border border-gray-100 shadow-sm text-sm">
                                      <span className="text-gray-700 truncate mr-2">{m.name}</span>
                                      <div className="flex gap-4">
                                        <span className="text-gray-400">{m.occasions}x</span>
                                        <span className="font-medium text-gray-900">{formatCurrency(m.avgPrice / 100)}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {/* Price Trend Chart */}
                            <div className="mt-8">
                              <h4 className="font-medium text-gray-900 mb-4">Price Trend</h4>
                              {row.observations.length > 1 ? (
                                <>
                                  <p id={`price-trend-summary-${rowId}`} className="sr-only">Price trend for {row.canonicalName}: {row.observations.length} comparable purchases, from {formatCurrency(row.minPrice / 100)} to {formatCurrency(row.maxPrice / 100)} per {row.standardUnit}.</p>
                                  <div aria-hidden="true" aria-describedby={`price-trend-summary-${rowId}`} className="h-64 w-full bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={row.observations}>
                                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-rule)" />
                                      <XAxis 
                                        dataKey="transactionDate" 
                                        tick={{ fontSize: 12, fill: 'var(--chart-muted)' }}
                                        axisLine={false}
                                        tickLine={false}
                                      />
                                      <YAxis 
                                        tickFormatter={(value) => `${(value / 100).toFixed(0)}`}
                                        tick={{ fontSize: 12, fill: 'var(--chart-muted)' }}
                                        axisLine={false}
                                        tickLine={false}
                                        domain={['auto', 'auto']}
                                      />
                                      <Tooltip 
                                        formatter={(value: number) => [formatCurrency(value / 100), `Price per ${row.standardUnit}`]}
                                        labelFormatter={(label) => `Date: ${label}`}
                                        content={({ active, payload }) => {
                                          if (active && payload && payload.length) {
                                            const obs = payload[0].payload as ItemObservation;
                                            return (
                                              <div className="bg-gray-900 text-white p-3 rounded-lg shadow-xl text-xs space-y-1">
                                                <div className="font-medium mb-2">{obs.transactionDate}</div>
                                                <div className="flex justify-between gap-4">
                                                  <span className="text-gray-400">Merchant:</span>
                                                  <span>{obs.merchant}</span>
                                                </div>
                                                <div className="flex justify-between gap-4">
                                                  <span className="text-gray-400">Raw Name:</span>
                                                  <span>{obs.rawName}</span>
                                                </div>
                                                <div className="flex justify-between gap-4">
                                                  <span className="text-gray-400">Line Total:</span>
                                                  <span>{formatCurrency(obs.lineTotal / 100)}</span>
                                                </div>
                                                <div className="flex justify-between gap-4 border-t border-gray-700 mt-2 pt-2">
                                                  <span className="text-gray-400">Unit Price:</span>
                                                  <span className="font-bold">{formatCurrency(obs.unitPrice / 100)}</span>
                                                </div>
                                                <div className="mt-2 text-blue-300 hover:text-blue-200 underline">
                                                  <Link to={`/receipts?id=${obs.receiptId}`}>View Receipt</Link>
                                                </div>
                                              </div>
                                            );
                                          }
                                          return null;
                                        }}
                                      />
                                      <Line 
                                        type="monotone" 
                                        dataKey="unitPrice" 
                                        stroke="var(--chart-1)"
                                        strokeWidth={2}
                                        dot={{ r: 4, strokeWidth: 2 }}
                                        activeDot={{ r: 6, strokeWidth: 0 }}
                                        isAnimationActive={false}
                                      />
                                    </LineChart>
                                  </ResponsiveContainer>
                                  </div>
                                </>
                              ) : (
                                <div className="p-4 bg-white border border-gray-100 rounded-xl text-sm text-gray-500 shadow-sm">
                                  Insufficient observations to generate a price trend. Need at least 2 comparable purchases.
                                </div>
                              )}
                            </div>

                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
