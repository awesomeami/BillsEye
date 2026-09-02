import { APP_CONFIG } from '../../utilities/config';
import { parseCalendarDateTimestamp } from '../../domain/calendarDate';

export interface DailyTrendSourcePoint {
  date: string;
  total: number;
}

export interface DailyTrendChartPoint extends DailyTrendSourcePoint {
  timestamp: number;
}

export function parseCalendarDate(date: string): number | null {
  return parseCalendarDateTimestamp(date);
}

export function buildDailyTrendChartData(points: readonly DailyTrendSourcePoint[]): DailyTrendChartPoint[] {
  const totalsByTimestamp = new Map<number, DailyTrendChartPoint>();

  for (const point of points) {
    const timestamp = parseCalendarDate(point.date);
    if (timestamp === null) continue;

    const existing = totalsByTimestamp.get(timestamp);
    if (existing) {
      existing.total += point.total;
    } else {
      totalsByTimestamp.set(timestamp, { ...point, timestamp });
    }
  }

  return [...totalsByTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

export function formatFullTrendDate(timestamp: number): string {
  return new Intl.DateTimeFormat(APP_CONFIG.locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

export function formatTrendMonthYear(timestamp: number): string {
  return new Intl.DateTimeFormat(APP_CONFIG.locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
  }).format(new Date(timestamp));
}
