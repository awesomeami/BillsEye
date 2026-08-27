export const APP_CONFIG = {
  currency: 'PKR',
  locale: 'en-PK',
  timeZone: 'Asia/Karachi',
};

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat(APP_CONFIG.locale, {
    style: 'currency',
    currency: APP_CONFIG.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: Date | string | number): string {
  const d = new Date(date);
  return new Intl.DateTimeFormat(APP_CONFIG.locale, {
    timeZone: APP_CONFIG.timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}
