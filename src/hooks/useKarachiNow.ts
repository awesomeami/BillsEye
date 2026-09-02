import { useEffect, useState } from 'react';
import { getKarachiYYYYMMDD } from '../domain/analytics';
import { parseCalendarDate } from '../domain/calendarDate';

const KARACHI_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;

export function millisecondsUntilNextKarachiDay(referenceDate: Date): number {
  const currentDate = parseCalendarDate(getKarachiYYYYMMDD(referenceDate));
  if (!currentDate) return 60_000;

  const nextMidnightUtc = Date.UTC(
    currentDate.year,
    currentDate.month - 1,
    currentDate.day + 1,
  ) - KARACHI_UTC_OFFSET_MS;
  return Math.max(1_000, nextMidnightUtc - referenceDate.getTime() + 250);
}

/** Refreshes date-based calculations as soon as the Karachi date changes. */
export function useKarachiNow(): Date {
  const [referenceDate, setReferenceDate] = useState(() => new Date());

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setReferenceDate(new Date()),
      millisecondsUntilNextKarachiDay(referenceDate),
    );
    return () => window.clearTimeout(timeout);
  }, [referenceDate]);

  return referenceDate;
}
