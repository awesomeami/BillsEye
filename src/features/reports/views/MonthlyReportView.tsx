import React, { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { generateMonthlyReport } from '../../../domain/analytics';
import { ReceiptDocument } from '../../../domain/schema';
import { formatCurrency } from '../../../utilities/config';
import { DateRange } from '../../../domain/analytics';

interface Props {
  receipts: ReceiptDocument[];
  range: DateRange;
}

export function MonthlyReportView({ receipts, range }: Props) {
  const data = useMemo(() => generateMonthlyReport(receipts, range), [receipts, range]);

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
        <section aria-label="Monthly spending summary" className="rounded-2xl border border-blue-100 bg-blue-50 p-6">
          <p className="text-sm font-medium text-blue-900">First month in this period</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">{formatCurrency(data[0].total / 100)}</p>
          <p className="mt-2 text-sm text-blue-800">{data[0].count} receipt{data[0].count === 1 ? '' : 's'} recorded in {data[0].month}. Add another month to compare spending over time.</p>
        </section>
      ) : <>
      <p id="monthly-chart-summary" className="sr-only">Monthly spending chart. The detailed monthly totals, receipt counts, averages, and month-to-month changes are available in the table below.</p>
      <div aria-hidden="true" aria-describedby="monthly-chart-summary" className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey="month" stroke="#9ca3af" fontSize={12} tickMargin={10} />
            <YAxis tickFormatter={(val: number) => formatCurrency(val / 100)} stroke="#9ca3af" fontSize={12} width={80} />
            <Tooltip 
              formatter={(value: number) => formatCurrency(value / 100)}
              cursor={{ fill: '#f3f4f6' }}
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            <Bar dataKey="total" name="Total Spend" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      </>}

      <div className="space-y-3 xl:hidden">
        {data.map((row) => <article key={row.month} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-gray-900">{row.month}</p><p className="mt-1 text-xs text-gray-500">{row.count} receipt{row.count === 1 ? '' : 's'} · Average {formatCurrency(row.average / 100)}</p></div><p className="text-lg font-bold text-gray-900">{formatCurrency(row.total / 100)}</p></div>{row.changePct !== null && <p className={`mt-3 text-sm font-medium ${row.changePct > 0 ? 'text-red-700' : 'text-green-700'}`}>{row.changePct > 0 ? '+' : ''}{row.changePct.toFixed(1)}% from the previous month</p>}</article>)}
      </div>

      <div className="app-card hidden overflow-hidden xl:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <caption className="sr-only">Monthly spending summary</caption>
            <thead className="text-xs text-gray-500 bg-gray-50 uppercase border-b border-gray-100">
              <tr>
                <th className="px-6 py-4 font-medium">Month</th>
                <th className="px-6 py-4 font-medium text-right">Total</th>
                <th className="px-6 py-4 font-medium text-right">Receipts</th>
                <th className="px-6 py-4 font-medium text-right">Average</th>
                <th className="px-6 py-4 font-medium text-right">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((row) => (
                <tr key={row.month} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{row.month}</td>
                  <td className="px-6 py-4 text-right">{formatCurrency(row.total / 100)}</td>
                  <td className="px-6 py-4 text-right">{row.count}</td>
                  <td className="px-6 py-4 text-right">{formatCurrency(row.average / 100)}</td>
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
