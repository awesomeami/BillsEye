const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CalendarDateParts {
  value: string;
  year: number;
  month: number;
  day: number;
  timestamp: number;
}

/**
 * Parses a YYYY-MM-DD value without allowing JavaScript to roll impossible
 * dates into the following month (for example, 2026-02-31 -> 2026-03-03).
 */
export function parseCalendarDate(value: unknown): CalendarDateParts | null {
  if (typeof value !== 'string') return null;

  const match = CALENDAR_DATE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day) return null;

  return { value, year, month, day, timestamp };
}

export function isValidCalendarDate(value: unknown): value is string {
  return parseCalendarDate(value) !== null;
}

export function parseCalendarDateTimestamp(value: string): number | null {
  return parseCalendarDate(value)?.timestamp ?? null;
}
