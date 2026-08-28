export const APP_CONFIG = {
  currency: 'PKR',
  locale: 'en-PK',
  timeZone: 'Asia/Karachi',
} as const;

export type RegionalConfig = Pick<typeof APP_CONFIG, 'currency' | 'locale' | 'timeZone'>;

export function formatCurrency(amount: number, config: RegionalConfig = APP_CONFIG): string {
  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: Date | string | number, config: RegionalConfig = APP_CONFIG): string {
  const d = new Date(date);
  return new Intl.DateTimeFormat(config.locale, {
    timeZone: config.timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}
