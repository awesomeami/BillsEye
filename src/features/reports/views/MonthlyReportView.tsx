import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { generateMonthlyReport } from '../../../domain/analytics';
import { ReceiptDocument } from '../../../domain/schema';
import { formatCurrency } from '../../../utilities/config';
import { DateRange } from '../../../domain/analytics';
import { SortableTableHeader } from '../../../components/ui/SortableTableHeader';
import { getNextReportSort, ReportSortState, sortReportRows } from '../reportSorting';

interface Props {
  receipts: ReceiptDocument[];
  range: DateRange;
}

type MonthlySortField = 'month' | 'total' | 'count' | 'average' | 'changePct';

export function MonthlyReportView({ receipts, range }: Props) {
  const data = useMemo(() => generateMonthlyReport(receipts, range), [receipts, range]);
  const [sort, setSort] = useState<ReportSortState<MonthlySortField> | null>(null);
  const sortedData = useMemo(() => sortReportRows(data, sort, (row, field) => row[field]), [data, sort]);
  const handleSort = (field: MonthlySortField, initialDirection: 'asc' | 'desc') => {
    setSort(current => getNextReportSort(current, field, initialDirection));
  };

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
        <p>No monthly data available for the selected period.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data.length === 1 ? (
        <section aria-label="Monthly spending summary" className="border-l-4 border-blue-600 bg-blue-50 p-6">
          <p className="text-sm font-medium text-blue-900">First month in this period</p>
          <p className="money-display mt-3 text-4xl text-gray-900">{formatCurrency(data[0].total / 100)}</p>
          <p className="mt-2 text-sm text-blue-800">{data[0].count} receipt{data[0].count === 1 ? '' : 's'} recorded in {data[0].month}. Add another month to compare spending over time.</p>
        </section>
      ) : <>
      <p id="monthly-chart-summary" className="sr-only">Monthly spending chart. The detailed monthly totals, receipt counts, averages, and month-to-month changes are available in the table below.</p>
      <div aria-hidden="true" aria-describedby="monthly-chart-summary" className="app-card h-80 bg-white p-6">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-rule)" />
            <XAxis dataKey="month" stroke="var(--chart-muted)" fontSize={12} tickMargin={10} />
            <YAxis tickFormatter={(val: number) => formatCurrency(val / 100)} stroke="var(--chart-muted)" fontSize={12} width={80} />
            <Tooltip 
              formatter={(value: number) => formatCurrency(value / 100)}
              cursor={{ fill: 'var(--surface-muted)' }}
              contentStyle={{ background: 'var(--surface-raised)', borderRadius: '4px', border: '1px solid var(--rule)', boxShadow: 'none', color: 'var(--ink)' }}
            />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            <Bar dataKey="total" name="Total Spend" fill="var(--chart-1)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      </>}

      <div className="space-y-3 xl:hidden">
        {sortedData.map((row) => <article key={row.month} className="app-card bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-gray-900">{row.month}</p><p className="mt-1 text-xs text-gray-500">{row.count} receipt{row.count === 1 ? '' : 's'}. Average {formatCurrency(row.average / 100)}</p></div><p className="money-value text-lg font-bold text-gray-900">{formatCurrency(row.total / 100)}</p></div>{row.changePct !== null && <p className={`mt-3 text-sm font-medium ${row.changePct > 0 ? 'text-red-700' : 'text-green-700'}`}>{row.changePct > 0 ? '+' : ''}{row.changePct.toFixed(1)}% from the previous month</p>}</article>)}
      </div>

      <div className="app-card hidden overflow-hidden xl:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <caption className="sr-only">Monthly spending summary</caption>
            <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
              <tr>
                <SortableTableHeader label="Month" active={sort?.field === 'month'} direction={sort?.direction ?? 'asc'} initialDirection="asc" onSort={() => handleSort('month', 'asc')} />
                <SortableTableHeader label="Total" active={sort?.field === 'total'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('total', 'desc')} align="right" />
                <SortableTableHeader label="Receipts" active={sort?.field === 'count'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('count', 'desc')} align="right" />
                <SortableTableHeader label="Average" active={sort?.field === 'average'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('average', 'desc')} align="right" />
                <SortableTableHeader label="Change" active={sort?.field === 'changePct'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('changePct', 'desc')} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedData.map((row) => (
                <tr key={row.month} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{row.month}</td>
                  <td className="money-value px-6 py-4 text-right">{formatCurrency(row.total / 100)}</td>
                  <td className="px-6 py-4 text-right">{row.count}</td>
                  <td className="money-value px-6 py-4 text-right">{formatCurrency(row.average / 100)}</td>
                  <td className="px-6 py-4 text-right">
                    {row.changePct !== null ? (
                      <span className={row.changePct > 0 ? 'text-red-600' : 'text-green-600'}>
                        {row.changePct > 0 ? '+' : ''}{row.changePct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
