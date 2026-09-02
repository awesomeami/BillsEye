import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Brush } from 'recharts';
import { DashboardSummary } from '../../domain/analytics';
import { formatCurrency } from '../../utilities/config';
import {
  buildDailyTrendChartData,
  DailyTrendChartPoint,
  formatFullTrendDate,
  formatTrendMonthYear,
} from './dashboardTrend';

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
];

const tooltipStyle = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--rule)',
  borderRadius: '4px',
  boxShadow: 'none',
  color: 'var(--ink)',
};

interface DashboardChartsProps {
  categoryComposition: DashboardSummary['categoryComposition'];
  dailyTrend: DashboardSummary['dailyTrend'];
}

export function DashboardCharts({ categoryComposition, dailyTrend }: DashboardChartsProps) {
  const trendData = useMemo(() => buildDailyTrendChartData(dailyTrend), [dailyTrend]);
  const trendVersion = trendData.length === 0
    ? 'empty'
    : `${trendData.length}-${trendData[0].timestamp}-${trendData[trendData.length - 1].timestamp}`;

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
                  <Pie data={categoryComposition} cx="50%" cy="50%" innerRadius="50%" outerRadius="76%" paddingAngle={3} dataKey="total" nameKey="name" isAnimationActive={false}>
                    {categoryComposition.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(value / 100)} contentStyle={tooltipStyle} />
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
        {trendData.length > 1 ? (
          <DailySpendingTrend key={trendVersion} data={trendData} />
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
            {trendData.length === 1 ? `You've recorded ${formatCurrency(trendData[0].total / 100)} on ${formatFullTrendDate(trendData[0].timestamp)}.` : 'Your daily spending trend will appear after your first dated receipt.'}
          </div>
        )}
      </section>
    </div>
  );
}

interface BrushRange {
  startIndex: number;
  endIndex: number;
}

function DailySpendingTrend({ data }: { data: DailyTrendChartPoint[] }) {
  const [range, setRange] = useState<BrushRange>({ startIndex: 0, endIndex: data.length - 1 });
  const rangeStart = data[range.startIndex];
  const rangeEnd = data[range.endIndex];
  const selectedDomain = rangeStart.timestamp === rangeEnd.timestamp
    ? [rangeStart.timestamp - 43_200_000, rangeEnd.timestamp + 43_200_000]
    : [rangeStart.timestamp, rangeEnd.timestamp];

  const handleBrushChange = (nextRange: { startIndex?: number; endIndex?: number }) => {
    const startIndex = Math.max(0, Math.min(nextRange.startIndex ?? 0, data.length - 1));
    const endIndex = Math.max(startIndex, Math.min(nextRange.endIndex ?? data.length - 1, data.length - 1));
    setRange({ startIndex, endIndex });
  };

  return (
    <>
      <p id="dashboard-trend-summary" className="sr-only">Daily spending uses complete calendar dates and proportional elapsed-time spacing. Exact values are available in chart tooltips.</p>
      <div aria-hidden="true" aria-describedby="dashboard-trend-summary" className="h-80 min-h-0 sm:h-[22rem]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-rule)" />
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={selectedDomain}
              allowDataOverflow
              tickFormatter={formatFullTrendDate}
              stroke="var(--chart-muted)"
              fontSize={12}
              minTickGap={28}
              tickMargin={10}
            />
            <YAxis tickFormatter={(value: number) => formatCurrency(value / 100)} stroke="var(--chart-muted)" fontSize={12} width={58} />
            <Tooltip formatter={(value: number) => formatCurrency(value / 100)} labelFormatter={(label) => `Date: ${formatFullTrendDate(Number(label))}`} contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="total" stroke="var(--chart-1)" strokeWidth={3} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} />
            <Brush
              dataKey="timestamp"
              startIndex={range.startIndex}
              endIndex={range.endIndex}
              onChange={handleBrushChange}
              height={44}
              travellerWidth={22}
              gap={1}
              stroke="var(--chart-1)"
              fill="var(--surface-muted)"
              tickFormatter={formatTrendMonthYear}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="tabular-nums mt-2 text-center text-xs font-medium text-gray-600" aria-label="Selected trend date range" aria-live="polite">
        {formatTrendMonthYear(rangeStart.timestamp)} – {formatTrendMonthYear(rangeEnd.timestamp)}
      </p>
    </>
  );
}
