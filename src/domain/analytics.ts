
import { CategoryDocument, ReceiptDocument } from './schema';
import { groupAndAnalyzeItems, ItemAnalytics } from './items';
import { getReceiptTotal } from './reconciliation';
export { getReceiptTotal } from './reconciliation';
import { getReceiptItemCategoryLabel, resolveReceiptItemCategoryId } from './categories';
import { APP_CONFIG } from '../utilities/config';
import { parseCalendarDate } from './calendarDate';

export type DateRangeFilter = 'this_month' | 'last_month' | 'previous_3_months' | 'current_and_previous_2_months' | 'this_year' | 'all_time' | 'custom';

export interface DateRange {
  start: string | null; 
  end: string | null;   
}

export function getDefaultCustomDateRange(referenceDate: Date = new Date()): DateRange {
  const today = getKarachiYYYYMMDD(referenceDate);
  return { start: `${today.substring(0, 7)}-01`, end: today };
}

export function getKarachiYYYYMMDD(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_CONFIG.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export function offsetMonth(yyyymm: string, monthsOffset: number): string {
  let year = parseInt(yyyymm.substring(0, 4), 10);
  let month = parseInt(yyyymm.substring(5, 7), 10) - 1; 
  month += monthsOffset;
  year += Math.floor(month / 12);
  month = ((month % 12) + 12) % 12; 
  const smonth = (month + 1).toString().padStart(2, '0');
  return `${year}-${smonth}`;
}

export function getEndOfMonth(yyyymm: string): string {
  const year = parseInt(yyyymm.substring(0, 4), 10);
  const month = parseInt(yyyymm.substring(5, 7), 10);
  const lastDay = new Date(year, month, 0).getDate();
  return `${yyyymm}-${lastDay.toString().padStart(2, '0')}`;
}

export function getDateRange(filter: DateRangeFilter, referenceDate: Date = new Date()): DateRange {
  const today = getKarachiYYYYMMDD(referenceDate);
  const yyyymm = today.substring(0, 7);
  const year = today.substring(0, 4);

  switch (filter) {
    case 'this_month':
      return { start: `${yyyymm}-01`, end: getEndOfMonth(yyyymm) };
    case 'last_month': {
      const lastMonth = offsetMonth(yyyymm, -1);
      return { start: `${lastMonth}-01`, end: getEndOfMonth(lastMonth) };
    }
    case 'previous_3_months': {
      const endPrev = offsetMonth(yyyymm, -1);
      const startPrev = offsetMonth(yyyymm, -3);
      return { start: `${startPrev}-01`, end: getEndOfMonth(endPrev) };
    }
    case 'current_and_previous_2_months': {
      const startCurrent = offsetMonth(yyyymm, -2);
      return { start: `${startCurrent}-01`, end: getEndOfMonth(yyyymm) };
    }
    case 'this_year':
      return { start: `${year}-01-01`, end: `${year}-12-31` };
    case 'all_time':
    case 'custom':
      return { start: null, end: null };
  }
}

export function isDateInRange(dateStr: string | null | undefined, range: DateRange): boolean {
  const calendarDate = parseCalendarDate(dateStr);
  if (!calendarDate) return false;
  if (range.start && calendarDate.value < range.start) return false;
  if (range.end && calendarDate.value > range.end) return false;
  return true;
}

export function getConfirmedReceipts(receipts: ReceiptDocument[]): ReceiptDocument[] {
  return receipts.filter(r => r.status === 'confirmed');
}

export interface DashboardSummary {
  currentTotal: number;
  currentTotalAvailable: boolean;
  prevTotal: number;
  previousTotalAvailable: boolean;
  changeAbs: number;
  changePct: number | null;
  needsDateCount: number;
  excludedNullCount: number;
  receiptCount: number;
  averageReceiptValue: number;
  pendingCount: number;
  topMerchants: { name: string; total: number }[];
  topItems: { name: string; total: number }[];
  categoryComposition: { name: string; total: number }[];
  dailyTrend: { date: string; total: number }[];
  recentReceipts: ReceiptDocument[];
}

export type DashboardPeriod = DateRangeFilter;

/**
 * Compares this month through the reference date with the same elapsed days of
 * the previous calendar month. The previous end is clamped for short months.
 */
export function getElapsedMonthComparisonRanges(referenceDate: Date = new Date()): {
  current: DateRange;
  previous: DateRange;
} {
  const today = getKarachiYYYYMMDD(referenceDate);
  const currentMonth = today.substring(0, 7);
  const previousMonth = offsetMonth(currentMonth, -1);
  const elapsedDay = Number.parseInt(today.substring(8, 10), 10);
  const previousLastDay = Number.parseInt(getEndOfMonth(previousMonth).substring(8, 10), 10);
  const previousEndDay = Math.min(elapsedDay, previousLastDay).toString().padStart(2, '0');

  return {
    current: { start: `${currentMonth}-01`, end: today },
    previous: { start: `${previousMonth}-01`, end: `${previousMonth}-${previousEndDay}` },
  };
}

// Aliases
export function applyMerchantAlias(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

export function calculateDashboardSummary(
  allReceipts: ReceiptDocument[], 
  referenceDate: Date = new Date(),
  categories: CategoryDocument[] = [],
  period: DashboardPeriod = 'this_month',
  customRange: DateRange = getDefaultCustomDateRange(referenceDate),
): DashboardSummary {
  const pendingCount = allReceipts.filter(r => r.status === 'pendingReview').length;
  const confirmed = getConfirmedReceipts(allReceipts);
  
  const comparisonRanges = getElapsedMonthComparisonRanges(referenceDate);
  const currentRange = period === 'this_month'
    ? comparisonRanges.current
    : period === 'custom' ? customRange : getDateRange(period, referenceDate);
  const lastMonthRange = comparisonRanges.previous;
  
  let currentTotal = 0;
  let prevTotal = 0;
  let currentKnownCount = 0;
  let previousKnownCount = 0;
  let needsDateCount = 0;
  let excludedNullCount = 0;
  
  const periodReceipts: ReceiptDocument[] = [];
  
  for (const r of confirmed) {
    if (!parseCalendarDate(r.transactionDate)) {
      needsDateCount++;
      continue;
    }
    const val = getReceiptTotal(r);
    
    if (isDateInRange(r.transactionDate, currentRange)) {
      if (val === null) {
        excludedNullCount++;
      } else {
        currentTotal += val;
        currentKnownCount++;
      }
      periodReceipts.push(r);
    } else if (period === 'this_month' && isDateInRange(r.transactionDate, lastMonthRange)) {
      if (val !== null) {
        prevTotal += val;
        previousKnownCount++;
      }
    }
  }

  const validPeriodReceipts = periodReceipts.filter(r => getReceiptTotal(r) !== null);
  const averageReceiptValue = validPeriodReceipts.length > 0 ? Math.round(currentTotal / validPeriodReceipts.length) : 0;
  const currentTotalAvailable = currentKnownCount > 0;
  const previousTotalAvailable = previousKnownCount > 0;
  const changeAbs = currentTotalAvailable && previousTotalAvailable ? currentTotal - prevTotal : 0;
  const changePct = currentTotalAvailable && previousTotalAvailable && prevTotal !== 0
    ? (changeAbs / prevTotal) * 100
    : null;
  
  const merchantMap = new Map<string, number>();
  const itemMap = new Map<string, number>();
  const dailyMap = new Map<string, number>();

  for (const r of validPeriodReceipts) {
    const rTotal = getReceiptTotal(r)!;
    const mName = applyMerchantAlias(r.merchantNormalized || r.merchantRaw || 'Unknown');
    merchantMap.set(mName, (merchantMap.get(mName) || 0) + rTotal);
    
    const date = r.transactionDate!;
    dailyMap.set(date, (dailyMap.get(date) || 0) + rTotal);
    
    for (const item of r.items) {
      const itemName = applyMerchantAlias(item.name || item.rawLineText || 'Unknown Item');
      itemMap.set(itemName, (itemMap.get(itemName) || 0) + (item.lineTotal || 0));
    }
  }

  const categoryComposition = generateCategoryReport(periodReceipts, currentRange, categories);

  return {
    currentTotal,
    currentTotalAvailable,
    prevTotal,
    previousTotalAvailable,
    changeAbs,
    changePct,
    needsDateCount,
    excludedNullCount,
    receiptCount: periodReceipts.length,
    averageReceiptValue,
    pendingCount,
    topMerchants: Array.from(merchantMap.entries()).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 5),
    topItems: Array.from(itemMap.entries()).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 5),
    categoryComposition: categoryComposition
      .filter(category => category.compositionTotal > 0)
      .map(category => ({ name: category.category, total: category.compositionTotal })),
    dailyTrend: Array.from(dailyMap.entries()).map(([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date)),
    recentReceipts: [...periodReceipts].sort((a, b) => {
      const dateComparison = (b.transactionDate || '').localeCompare(a.transactionDate || '');
      if (dateComparison !== 0) return dateComparison;
      const createdComparison = b.createdAt.localeCompare(a.createdAt);
      if (createdComparison !== 0) return createdComparison;
      return a.id.localeCompare(b.id);
    }).slice(0, 5)
  };
}

export function getFilteredReceipts(receipts: ReceiptDocument[], range: DateRange): ReceiptDocument[] {
  return receipts.filter(r => r.status === 'confirmed' && isDateInRange(r.transactionDate ?? null, range));
}

export interface MonthlyReportItem {
  month: string; 
  total: number;
  count: number;
  average: number;
  changePct: number | null;
}

export function generateMonthlyReport(receipts: ReceiptDocument[], range: DateRange): MonthlyReportItem[] {
  const filtered = getFilteredReceipts(receipts, range);
  const map = new Map<string, { total: number; count: number }>();
  
  for (const r of filtered) {
    if (!r.transactionDate) continue;
    const val = getReceiptTotal(r);
    if (val === null) continue;
    const monthKey = r.transactionDate.substring(0, 7);
    const current = map.get(monthKey) || { total: 0, count: 0 };
    map.set(monthKey, {
      total: current.total + val,
      count: current.count + 1
    });
  }

  const sortedKeys = Array.from(map.keys()).sort();
  const results: MonthlyReportItem[] = [];
  
  for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i];
    const data = map.get(key)!;
    const prevData = map.get(offsetMonth(key, -1));
    
    let changePct: number | null = null;
    if (prevData && prevData.total !== 0) {
      changePct = ((data.total - prevData.total) / prevData.total) * 100;
    }
    results.push({
      month: key,
      total: data.total,
      count: data.count,
      average: Math.round(data.total / data.count),
      changePct
    });
  }
  return results;
}

export interface CategoryReportItem {
  category: string;
  categoryId: string | null;
  filterValue: string | null;
  /** Positive outflows only; used for composition charts and percentages. */
  compositionTotal: number;
  /** Signed net amount; used for the report's financial total. */
  total: number;
  proportion: number;
  receiptCount: number;
}

function getCategoryReference(item: ReceiptDocument['items'][number], categories: CategoryDocument[]) {
  const categoryId = resolveReceiptItemCategoryId(item, categories);
  if (categoryId) {
    return {
      key: `id:${categoryId}`,
      categoryId,
      filterValue: categoryId,
      label: getReceiptItemCategoryLabel(item, categories),
    };
  }
  if (item.category) {
    return {
      key: `legacy:${item.category}`,
      categoryId: null,
      filterValue: item.category,
      label: getReceiptItemCategoryLabel(item, categories),
    };
  }
  return { key: 'uncategorized', categoryId: null, filterValue: null, label: 'Uncategorized' };
}

export function generateCategoryReport(
  receipts: ReceiptDocument[],
  range: DateRange,
  categories: CategoryDocument[] = [],
): CategoryReportItem[] {
  const filtered = getFilteredReceipts(receipts, range);
  const map = new Map<string, {
    total: number;
    compositionTotal: number;
    receiptIds: Set<string>;
    category: string;
    categoryId: string | null;
    filterValue: string | null;
  }>();

  for (const r of filtered) {
    const rTotal = getReceiptTotal(r);
    if (rTotal === null) continue;

    let itemSum = 0;
    for (const item of r.items) {
      const lineTotal = item.lineTotal;
      if (lineTotal == null) continue;
      const signedLineTotal = rTotal < 0 ? -Math.abs(lineTotal) : lineTotal;
      const category = getCategoryReference(item, categories);
      const current = map.get(category.key) || {
        total: 0,
        compositionTotal: 0,
        receiptIds: new Set(),
        category: category.label,
        categoryId: category.categoryId,
        filterValue: category.filterValue,
      };
      current.total += signedLineTotal;
      current.compositionTotal += Math.max(0, signedLineTotal);
      current.receiptIds.add(r.id);
      map.set(category.key, current);
      itemSum += signedLineTotal;
    }
    
    // Compute the difference between item lines and the receipt total.
    // Refund/negative means diff goes the other way.
    const diff = rTotal - itemSum;
    if (diff !== 0) {
      const current = map.get('adjustments') || {
        total: 0,
        compositionTotal: 0,
        receiptIds: new Set(),
        category: 'Adjustments / Unallocated',
        categoryId: null,
        filterValue: null,
      };
      current.total += diff;
      current.compositionTotal += Math.max(0, diff);
      current.receiptIds.add(r.id);
      map.set('adjustments', current);
    }
  }

  const grossSpendTotal = Array.from(map.values())
    .reduce((sum, data) => sum + data.compositionTotal, 0);

  return Array.from(map.entries())
    .map(([, data]) => ({
      category: data.category,
      categoryId: data.categoryId,
      filterValue: data.filterValue,
      total: data.total,
      compositionTotal: data.compositionTotal,
      proportion: grossSpendTotal > 0
        ? (data.compositionTotal / grossSpendTotal) * 100
        : 0,
      receiptCount: data.receiptIds.size
    }))
    .sort((a, b) => b.total - a.total);
}

export interface MerchantReportItem {
  merchant: string;
  total: number;
  visits: number;
  averageBasket: number;
  firstPurchase: string | null;
  lastPurchase: string | null;
}

export function generateMerchantReport(receipts: ReceiptDocument[], range: DateRange): MerchantReportItem[] {
  const filtered = getFilteredReceipts(receipts, range);
  const map = new Map<string, { total: number; visits: number; dates: string[] }>();
  for (const r of filtered) {
    const val = getReceiptTotal(r);
    if (val === null) continue;
    const merchant = applyMerchantAlias(r.merchantNormalized || r.merchantRaw || 'Unknown');
    const current = map.get(merchant) || { total: 0, visits: 0, dates: [] };
    current.total += val;
    current.visits += 1;
    if (r.transactionDate) current.dates.push(r.transactionDate);
    map.set(merchant, current);
  }
  return Array.from(map.entries())
    .map(([merchant, data]) => {
      data.dates.sort();
      return {
        merchant,
        total: data.total,
        visits: data.visits,
        averageBasket: Math.round(data.total / data.visits),
        firstPurchase: data.dates.length > 0 ? data.dates[0] : null,
        lastPurchase: data.dates.length > 0 ? data.dates[data.dates.length - 1] : null,
      };
    })
    .sort((a, b) => b.total - a.total);
}

export function generateItemReport(receipts: ReceiptDocument[], range: DateRange): ItemAnalytics[] {
  const filtered = getFilteredReceipts(receipts, range);
  return groupAndAnalyzeItems(filtered);
}

export interface SummaryInsights {
  largestIncreases: ItemAnalytics[];
  largestDecreases: ItemAnalytics[];
  topSpendingItems: ItemAnalytics[];
  categoryChanges: {
    category: string;
    changePct: number;
    leadingItem: string | null;
    leadingMerchant: string | null;
  }[];
}

export function generateSummaryInsights(
  receipts: ReceiptDocument[],
  referenceDate: Date = new Date(),
  categories: CategoryDocument[] = [],
): SummaryInsights {
  const thisMonthRange = getDateRange('this_month', referenceDate);
  const lastMonthRange = getDateRange('last_month', referenceDate);
  const thisMonthReceipts = getFilteredReceipts(receipts, thisMonthRange);
  const lastMonthReceipts = getFilteredReceipts(receipts, lastMonthRange);
  const thisMonthItems = groupAndAnalyzeItems(thisMonthReceipts);
  
  const itemsWithChanges = thisMonthItems.filter(item => item.priceChangePct !== null);
  const largestIncreases = [...itemsWithChanges]
    .filter(i => i.priceChangePct! > 0)
    .sort((a, b) => b.priceChangePct! - a.priceChangePct!)
    .slice(0, 3);
  const largestDecreases = [...itemsWithChanges]
    .filter(i => i.priceChangePct! < 0)
    .sort((a, b) => a.priceChangePct! - b.priceChangePct!)
    .slice(0, 3);
  const topSpendingItems = [...thisMonthItems]
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 5);

  const thisMonthCats = generateCategoryReport(thisMonthReceipts, {start: null, end: null}, categories);
  const lastMonthCats = generateCategoryReport(lastMonthReceipts, {start: null, end: null}, categories);
  const lastMonthCatMap = new Map(lastMonthCats.map(c => [c.filterValue ?? c.category, c.total]));
  const categoryChanges: SummaryInsights['categoryChanges'] = [];
  
  for (const cat of thisMonthCats) {
    const categoryKey = cat.filterValue ?? cat.category;
    const prevTotal = lastMonthCatMap.get(categoryKey);
    if (prevTotal && prevTotal > 0) {
      const changePct = ((cat.total - prevTotal) / prevTotal) * 100;
      if (Math.abs(changePct) > 5) { 
        const catReceipts = thisMonthReceipts.filter(receipt => receipt.items.some(item => {
          const itemReference = getCategoryReference(item, categories);
          return (itemReference.filterValue ?? itemReference.label) === categoryKey;
        }));
        
        const itemSpendMap = new Map<string, number>();
        const merchantSpendMap = new Map<string, number>();
        for (const r of catReceipts) {
          const merchant = applyMerchantAlias(r.merchantNormalized || r.merchantRaw || 'Unknown');
          let rCatSpend = 0;
          for (const item of r.items) {
            const itemReference = getCategoryReference(item, categories);
            if ((itemReference.filterValue ?? itemReference.label) === categoryKey) {
              const lineTotal = item.lineTotal || 0;
              rCatSpend += lineTotal;
              const itemName = applyMerchantAlias(item.name || item.rawLineText || 'Unknown');
              itemSpendMap.set(itemName, (itemSpendMap.get(itemName) || 0) + lineTotal);
            }
          }
          merchantSpendMap.set(merchant, (merchantSpendMap.get(merchant) || 0) + rCatSpend);
        }
        let leadingItem: string | null = null;
        let maxItemSpend = 0;
        for (const [name, spend] of itemSpendMap.entries()) {
          if (spend > maxItemSpend) { maxItemSpend = spend; leadingItem = name; }
        }
        let leadingMerchant: string | null = null;
        let maxMerchantSpend = 0;
        for (const [name, spend] of merchantSpendMap.entries()) {
          if (spend > maxMerchantSpend) { maxMerchantSpend = spend; leadingMerchant = name; }
        }
        categoryChanges.push({
          category: cat.category,
          changePct,
          leadingItem,
          leadingMerchant
        });
      }
    }
  }
  categoryChanges.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  return {
    largestIncreases,
    largestDecreases,
    topSpendingItems,
    categoryChanges: categoryChanges.slice(0, 3)
  };
}
