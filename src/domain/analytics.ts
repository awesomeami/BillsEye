
import { ReceiptDocument } from './schema';
import { groupAndAnalyzeItems, ItemAnalytics } from './items';
import { reconcileReceipt } from './reconciliation';

export type DateRangeFilter = 'this_month' | 'last_month' | 'previous_3_months' | 'current_and_previous_2_months' | 'this_year' | 'all_time' | 'custom';

export interface DateRange {
  start: string | null; 
  end: string | null;   
}

export function getKarachiYYYYMMDD(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
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

export function isDateInRange(dateStr: string | null, range: DateRange): boolean {
  if (!dateStr) return false;
  if (!range.start || !range.end) return true;
  return dateStr >= range.start && dateStr <= range.end;
}

export function getReceiptTotal(r: ReceiptDocument): number | null {
  if (r.printedGrandTotal !== null && r.printedGrandTotal !== undefined) {
    return r.printedGrandTotal;
  }
  const rec = reconcileReceipt(r.items || [], r);
  if (rec.computedLineTotal !== null) {
    return rec.computedLineTotal + (r.printedTax ?? 0) - (r.printedDiscount ?? 0);
  }
  return null;
}

export function getConfirmedReceipts(receipts: ReceiptDocument[]): ReceiptDocument[] {
  return receipts.filter(r => r.status === 'confirmed');
}

export interface DashboardSummary {
  currentTotal: number;
  prevTotal: number;
  changeAbs: number;
  changePct: number | null;
  mtdPriorTotal: number | null;
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

// Aliases
export function applyMerchantAlias(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

export function calculateDashboardSummary(
  allReceipts: ReceiptDocument[], 
  referenceDate: Date = new Date()
): DashboardSummary {
  const pendingCount = allReceipts.filter(r => r.status === 'pendingReview').length;
  const confirmed = getConfirmedReceipts(allReceipts);
  
  const thisMonthRange = getDateRange('this_month', referenceDate);
  const lastMonthRange = getDateRange('last_month', referenceDate);
  
  let currentTotal = 0;
  let prevTotal = 0;
  let mtdPriorTotal = 0;
  let needsDateCount = 0;
  let excludedNullCount = 0;
  
  const thisMonthReceipts: ReceiptDocument[] = [];
  const todayStr = getKarachiYYYYMMDD(referenceDate);
  const dayOfMonthStr = todayStr.substring(8, 10);
  
  for (const r of confirmed) {
    if (!r.transactionDate) {
      needsDateCount++;
      continue;
    }
    const val = getReceiptTotal(r);
    
    if (isDateInRange(r.transactionDate, thisMonthRange)) {
      if (val === null) {
        excludedNullCount++;
      } else {
        currentTotal += val;
      }
      thisMonthReceipts.push(r);
    } else if (isDateInRange(r.transactionDate, lastMonthRange)) {
      if (val !== null) {
        prevTotal += val;
        const rDay = r.transactionDate.substring(8, 10);
        if (rDay <= dayOfMonthStr) {
          mtdPriorTotal += val;
        }
      }
    }
  }

  const validReceiptsThisMonth = thisMonthReceipts.filter(r => getReceiptTotal(r) !== null);
  const averageReceiptValue = validReceiptsThisMonth.length > 0 ? Math.round(currentTotal / validReceiptsThisMonth.length) : 0;
  const changeAbs = currentTotal - prevTotal;
  const changePct = prevTotal === 0 ? null : (changeAbs / prevTotal) * 100;
  
  const merchantMap = new Map<string, number>();
  const itemMap = new Map<string, number>();
  const dailyMap = new Map<string, number>();

  for (const r of validReceiptsThisMonth) {
    const rTotal = getReceiptTotal(r)!;
    const mName = applyMerchantAlias(r.merchantNormalized || r.merchantRaw || 'Unknown');
    merchantMap.set(mName, (merchantMap.get(mName) || 0) + rTotal);
    
    const day = r.transactionDate!.substring(8, 10);
    dailyMap.set(day, (dailyMap.get(day) || 0) + rTotal);
    
    for (const item of r.items) {
      const itemName = applyMerchantAlias(item.name || item.rawLineText || 'Unknown Item');
      itemMap.set(itemName, (itemMap.get(itemName) || 0) + (item.lineTotal || 0));
    }
  }

  const categoryComposition = generateCategoryReport(thisMonthReceipts, thisMonthRange);

  return {
    currentTotal,
    prevTotal,
    changeAbs,
    changePct,
    mtdPriorTotal: dayOfMonthStr < "28" ? mtdPriorTotal : null,
    needsDateCount,
    excludedNullCount,
    receiptCount: thisMonthReceipts.length,
    averageReceiptValue,
    pendingCount,
    topMerchants: Array.from(merchantMap.entries()).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 5),
    topItems: Array.from(itemMap.entries()).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 5),
    categoryComposition: categoryComposition.map(c => ({ name: c.category, total: c.total })),
    dailyTrend: Array.from(dailyMap.entries()).map(([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date)),
    recentReceipts: [...thisMonthReceipts].sort((a,b) => ((b.transactionDate || "") > (a.transactionDate || "") ? 1 : -1)).slice(0, 5)
  };
}

export function getFilteredReceipts(receipts: ReceiptDocument[], range: DateRange): ReceiptDocument[] {
  return receipts.filter(r => r.status === 'confirmed' && isDateInRange(r.transactionDate, range));
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
    const prevKey = i > 0 ? sortedKeys[i - 1] : null;
    const prevData = prevKey ? map.get(prevKey) : null;
    
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
  total: number;
  proportion: number;
  receiptCount: number;
}

export function generateCategoryReport(receipts: ReceiptDocument[], range: DateRange): CategoryReportItem[] {
  const filtered = getFilteredReceipts(receipts, range);
  const map = new Map<string, { total: number; receiptIds: Set<string> }>();
  let grandTotal = 0;
  
  for (const r of filtered) {
    const rTotal = getReceiptTotal(r);
    if (rTotal === null) continue;

    let itemSum = 0;
    for (const item of r.items) {
      if (item.lineTotal === null) continue;
      const cat = item.category || 'Uncategorized';
      const current = map.get(cat) || { total: 0, receiptIds: new Set() };
      current.total += item.lineTotal;
      current.receiptIds.add(r.id);
      map.set(cat, current);
      itemSum += item.lineTotal;
    }
    
    grandTotal += rTotal;
    // Compute diff between items and grandTotal, apply correct signs.
    // Refund/negative means diff goes the other way.
    const diff = rTotal - itemSum;
    if (diff !== 0) {
      const cat = 'Adjustments / Unallocated';
      const current = map.get(cat) || { total: 0, receiptIds: new Set() };
      current.total += diff;
      current.receiptIds.add(r.id);
      map.set(cat, current);
    }
  }

  return Array.from(map.entries())
    .map(([category, data]) => ({
      category,
      total: data.total,
      proportion: grandTotal > 0 ? (Math.abs(data.total) / Math.abs(grandTotal)) * 100 : 0,
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

export function generateSummaryInsights(receipts: ReceiptDocument[], referenceDate: Date = new Date()): SummaryInsights {
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

  const thisMonthCats = generateCategoryReport(thisMonthReceipts, {start: null, end: null}); 
  const lastMonthCats = generateCategoryReport(lastMonthReceipts, {start: null, end: null});
  const lastMonthCatMap = new Map(lastMonthCats.map(c => [c.category, c.total]));
  const categoryChanges = [];
  
  for (const cat of thisMonthCats) {
    const prevTotal = lastMonthCatMap.get(cat.category);
    if (prevTotal && prevTotal > 0) {
      const changePct = ((cat.total - prevTotal) / prevTotal) * 100;
      if (Math.abs(changePct) > 5) { 
        const catReceipts = thisMonthReceipts.filter(r => r.items.some(i => (i.category || 'Uncategorized') === cat.category));
        
        const itemSpendMap = new Map<string, number>();
        const merchantSpendMap = new Map<string, number>();
        for (const r of catReceipts) {
          const merchant = applyMerchantAlias(r.merchantNormalized || r.merchantRaw || 'Unknown');
          let rCatSpend = 0;
          for (const item of r.items) {
            if ((item.category || 'Uncategorized') === cat.category) {
              const lineTotal = item.lineTotal || 0;
              rCatSpend += lineTotal;
              const itemName = applyMerchantAlias(item.name || item.rawLineText || 'Unknown');
              itemSpendMap.set(itemName, (itemSpendMap.get(itemName) || 0) + lineTotal);
            }
          }
          merchantSpendMap.set(merchant, (merchantSpendMap.get(merchant) || 0) + rCatSpend);
        }
        let leadingItem = null;
        let maxItemSpend = 0;
        for (const [name, spend] of itemSpendMap.entries()) {
          if (spend > maxItemSpend) { maxItemSpend = spend; leadingItem = name; }
        }
        let leadingMerchant = null;
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
