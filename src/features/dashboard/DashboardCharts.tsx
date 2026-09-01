import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { DashboardSummary } from '../../domain/analytics';
import { APP_CONFIG, formatCurrency } from '../../utilities/config';

const COLORS = ['#3269e8', '#12b76a', '#f79009', '#7f56d9', '#06aed4', '#ee46bc', '#6172f3', '#15b79e'];

const formatTrendDate = (date: string) => new Intl.DateTimeFormat(APP_CONFIG.locale, {
  timeZone: APP_CONFIG.timeZone,
  month: 'short',
  day: 'numeric',
}).format(new Date(`${date}T00:00:00+05:00`));

interface DashboardChartsProps {
  categoryComposition: DashboardSummary['categoryComposition'];
  dailyTrend: DashboardSummary['dailyTrend'];
}

export function DashboardCharts({ categoryComposition, dailyTrend }: DashboardChartsProps) {
  return (
    <div className="grid grid-cols-1 gap-5 pt-1 lg:grid-cols-2">
      <section className="app-card flex min-h-72 flex-col p-5 sm:p-6">
        <h3 className="mb-4 font-semibold text-gray-950">Category Composition</h3>
        {categoryComposition.length > 0 ? (
          <>
            <p id="dashboard-category-summary" className="sr-only">Spending grouped by category. Percentages are listed below the chart.</p>
            <div aria-hidden="true" aria-describedby="dashboard-category-summary" className="h-56 min-h-0 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryComposition} cx="50%" cy="50%" innerRadius="50%" outerRadius="76%" paddingAngle={3} dataKey="total" nameKey="name">
                    {categoryComposition.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(value / 100)} contentStyle={{ borderRadius: '12px', border: '1px solid #e4e7ec', boxShadow: '0 8px 24px rgb(16 24 40 / 0.08)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div aria-label="Category chart legend" className="grid grid-cols-1 gap-x-5 gap-y-2 border-t border-gray-100 pt-4 text-sm sm:grid-cols-2">
              {categoryComposition.map((row, index) => (
                <div key={row.name} className="flex min-w-0 items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-gray-600"><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} /><span className="truncate">{row.name}</span></span>
                  <span className="tabular-nums shrink-0 font-medium text-gray-900">{formatCurrency(row.total / 100)}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">Add categories during review to see your spending mix.</div>
        )}
      </section>

      <section className="app-card flex min-h-72 flex-col p-5 sm:p-6">
        <h3 className="mb-4 font-semibold text-gray-950">Daily Spending Trend</h3>
        {dailyTrend.length > 1 ? (
          <>
            <p id="dashboard-trend-summary" className="sr-only">Daily spending trend with exact values available in chart tooltips.</p>
            <div aria-hidden="true" aria-describedby="dashboard-trend-summary" className="h-64 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eaecf0" />
                  <XAxis dataKey="date" tickFormatter={formatTrendDate} stroke="#98a2b3" fontSize={12} tickMargin={10} />
                  <YAxis tickFormatter={(value: number) => formatCurrency(value / 100)} stroke="#98a2b3" fontSize={12} width={58} />
                  <Tooltip formatter={(value: number) => formatCurrency(value / 100)} labelFormatter={(label) => `Date: ${formatTrendDate(String(label))}`} contentStyle={{ borderRadius: '12px', border: '1px solid #e4e7ec', boxShadow: '0 8px 24px rgb(16 24 40 / 0.08)' }} />
                  <Line type="monotone" dataKey="total" stroke="#12b76a" strokeWidth={3} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
            {dailyTrend.length === 1 ? `You've recorded ${formatCurrency(dailyTrend[0].total / 100)} on ${formatTrendDate(dailyTrend[0].date)}.` : 'Your daily spending trend will appear after your first dated receipt.'}
          </div>
        )}
      </section>
    </div>
  );
}
