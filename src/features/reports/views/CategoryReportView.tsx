import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { generateCategoryReport } from '../../../domain/analytics';
import { CategoryDocument, ReceiptDocument } from '../../../domain/schema';
import { formatCurrency } from '../../../utilities/config';
import { DateRange } from '../../../domain/analytics';
import { SortableTableHeader } from '../../../components/ui/SortableTableHeader';
import { getNextReportSort, ReportSortState, sortReportRows } from '../reportSorting';

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

interface Props {
  receipts: ReceiptDocument[];
  categories: CategoryDocument[];
  range: DateRange;
}

type CategorySortField = 'category' | 'total' | 'proportion' | 'receiptCount';

export function CategoryReportView({ receipts, categories, range }: Props) {
  const data = useMemo(() => generateCategoryReport(receipts, range, categories), [receipts, categories, range]);
  const pieData = useMemo(
    () => data.filter(row => row.compositionTotal > 0),
    [data],
  );
  const [sort, setSort] = useState<ReportSortState<CategorySortField> | null>(null);
  const sortedData = useMemo(() => sortReportRows(data, sort, (row, field) => row[field]), [data, sort]);
  const handleSort = (field: CategorySortField, initialDirection: 'asc' | 'desc') => {
    setSort(current => getNextReportSort(current, field, initialDirection));
  };

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
        <p>No category data available for the selected period.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p id="category-chart-summary" className="sr-only">Category spending chart. Percentages use gross purchases and exclude refunds; signed net totals and receipt counts are available in the table below.</p>
      <div className="app-card bg-white p-5 sm:p-6">
        <div aria-hidden="true" aria-describedby="category-chart-summary" className="h-64 sm:h-80">
        {pieData.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius="48%"
              outerRadius="72%"
              paddingAngle={2}
              dataKey="compositionTotal"
              nameKey="category"
              isAnimationActive={false}
            >
              {pieData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value: number) => formatCurrency(value / 100)}
              contentStyle={{ background: 'var(--surface-raised)', borderRadius: '4px', border: '1px solid var(--rule)', boxShadow: 'none', color: 'var(--ink)' }}
            />
          </PieChart>
        </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-gray-500">
            No positive spending is available for a composition chart.
          </div>
        )}
        </div>
        <div aria-label="Category chart legend" className="mt-4 grid grid-cols-1 gap-2 border-t border-gray-100 pt-4 text-sm sm:grid-cols-2">
          {pieData.map((row, index) => <div key={row.category} className="flex min-w-0 items-center justify-between gap-3"><span className="flex min-w-0 items-center gap-2 text-gray-700"><span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} /> <span className="truncate">{row.category}</span></span><span className="shrink-0 font-medium text-gray-900">{row.proportion.toFixed(1)}%</span></div>)}
        </div>
      </div>

      <div className="app-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <caption className="sr-only">Category spending summary</caption>
            <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
              <tr>
                <SortableTableHeader label="Category" active={sort?.field === 'category'} direction={sort?.direction ?? 'asc'} initialDirection="asc" onSort={() => handleSort('category', 'asc')} />
                <SortableTableHeader label="Total" active={sort?.field === 'total'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('total', 'desc')} align="right" />
                <SortableTableHeader label="% of Gross Spend" active={sort?.field === 'proportion'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('proportion', 'desc')} align="right" />
                <SortableTableHeader label="Contained in Receipts" active={sort?.field === 'receiptCount'} direction={sort?.direction ?? 'desc'} initialDirection="desc" onSort={() => handleSort('receiptCount', 'desc')} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedData.map((row) => (
                <tr key={row.category} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-medium text-blue-600">
                    {row.filterValue ? (
                      <Link to={`/receipts?category=${encodeURIComponent(row.filterValue)}`} className="hover:underline">
                        {row.category}
                      </Link>
                    ) : row.category}
                  </td>
                  <td className="money-value px-6 py-4 text-right">{formatCurrency(row.total / 100)}</td>
                  <td className="px-6 py-4 text-right">{row.proportion.toFixed(1)}%</td>
                  <td className="px-6 py-4 text-right">{row.receiptCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
