import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { generateItemReport } from '../../../domain/analytics';
import { ReceiptDocument } from '../../../domain/schema';
import { formatCurrency } from '../../../utilities/config';
import { DateRange } from '../../../domain/analytics';
import { ItemObservation } from '../../../domain/items';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  receipts: ReceiptDocument[];
  range: DateRange;
}

export function ItemReportView({ receipts, range }: Props) {
  const data = useMemo(() => generateItemReport(receipts, range), [receipts, range]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      <div className="space-y-3 xl:hidden">
        {data.map((row, idx) => {
          const rowId = `${row.canonicalName}-${row.unitCategory}-${idx}`;
          const isExpanded = expandedId === rowId;
          const hasChange = row.priceChangePct !== null;
          const isUp = hasChange && row.priceChangePct! > 0;
          const isDown = hasChange && row.priceChangePct! < 0;
          return (
            <article key={rowId} className="app-card overflow-hidden">
              <button type="button" aria-expanded={isExpanded} aria-controls={`mobile-item-details-${rowId}`} onClick={() => toggleExpand(rowId)} className="touch-target w-full p-4 text-left">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold capitalize text-gray-950">{row.canonicalName}</p>
                    <p className="mt-1 text-xs text-gray-500">{row.occasions} occasion{row.occasions === 1 ? '' : 's'} · Latest per {row.standardUnit}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular-nums font-bold text-gray-950">{formatCurrency(row.latestPrice / 100)}</p>
                    {hasChange ? <p className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${isUp ? 'text-red-700' : isDown ? 'text-green-700' : 'text-gray-500'}`}>{isUp ? <TrendingUp size={13} /> : isDown ? <TrendingDown size={13} /> : <Minus size={13} />}{Math.abs(row.priceChangePct!).toFixed(1)}%</p> : null}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-sm">
                  <span className="text-gray-500">Total spent</span>
                  <span className="flex items-center gap-2 font-semibold text-gray-900">{formatCurrency(row.totalSpent / 100)} {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
                </div>
              </button>
              {isExpanded ? (
                <div id={`mobile-item-details-${rowId}`} className="space-y-5 border-t border-gray-200 bg-gray-50 p-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <Metric label="Simple average" value={formatCurrency(row.simpleAverage / 100)} />
                    <Metric label="Weighted average" value={formatCurrency(row.weightedAverage / 100)} />
                    <Metric label="Median price" value={formatCurrency(row.medianPrice / 100)} />
                    <Metric label="Min / max" value={`${formatCurrency(row.minPrice / 100)} – ${formatCurrency(row.maxPrice / 100)}`} />
                  </div>
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-gray-900">Merchant averages</h4>
                    <div className="space-y-2">{row.merchants.map(merchant => <div key={merchant.name} className="flex items-center justify-between rounded-lg bg-white p-3 text-sm"><span className="min-w-0 truncate text-gray-700">{merchant.name}</span><span className="tabular-nums ml-3 shrink-0 font-medium">{formatCurrency(merchant.avgPrice / 100)}</span></div>)}</div>
                  </div>
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-gray-900">Price history</h4>
                    <div className="space-y-2">{row.observations.map((observation, observationIndex) => <Link key={`${observation.receiptId}-${observationIndex}`} to={`/receipts?id=${observation.receiptId}`} className="flex items-center justify-between rounded-lg bg-white p-3 text-sm hover:bg-blue-50"><span className="min-w-0"><span className="block font-medium text-gray-900">{observation.transactionDate}</span><span className="block truncate text-xs text-gray-500">{observation.merchant}</span></span><span className="tabular-nums ml-3 shrink-0 font-semibold text-blue-700">{formatCurrency(observation.unitPrice / 100)}</span></Link>)}</div>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="app-card hidden overflow-hidden xl:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <caption className="sr-only">Item price and spending summary. Activate an item row to show its details.</caption>
            <thead className="text-xs text-gray-500 bg-gray-50 uppercase border-b border-gray-100">
              <tr>
                <th className="px-6 py-4 font-medium">Canonical Item</th>
                <th className="px-6 py-4 font-medium text-right">Total Spent</th>
                <th className="px-6 py-4 font-medium text-right">Unit Price (Latest)</th>
                <th className="px-6 py-4 font-medium text-right">Change</th>
                <th className="px-6 py-4 font-medium text-right">Occasions</th>
                <th className="px-4 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((row, idx) => {
                const rowId = `${row.canonicalName}-${row.unitCategory}-${idx}`;
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
                      <td className="px-6 py-4 text-right font-medium">{formatCurrency(row.totalSpent / 100)}</td>
                      <td className="px-6 py-4 text-right">{formatCurrency(row.latestPrice / 100)} / {row.standardUnit}</td>
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
                                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                      <XAxis 
                                        dataKey="transactionDate" 
                                        tick={{ fontSize: 12, fill: '#6b7280' }} 
                                        axisLine={false}
                                        tickLine={false}
                                      />
                                      <YAxis 
                                        tickFormatter={(value) => `${(value / 100).toFixed(0)}`}
                                        tick={{ fontSize: 12, fill: '#6b7280' }}
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
                                        stroke="#3b82f6" 
                                        strokeWidth={2}
                                        dot={{ r: 4, strokeWidth: 2 }}
                                        activeDot={{ r: 6, strokeWidth: 0 }}
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

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-gray-100 bg-white p-3"><p className="text-xs text-gray-500">{label}</p><p className="tabular-nums mt-1 font-medium text-gray-900">{value}</p></div>;
}
