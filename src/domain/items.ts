import { ReceiptDocument } from './schema';
import { getReceiptTotal } from './reconciliation';

export type UnitCategory = 'mass' | 'volume' | 'count' | 'unknown';

export interface NormalizedUnit {
  category: UnitCategory;
  standardValue: number; // e.g., in kg, L, or pieces
  standardUnit: string;  // 'kg', 'L', 'pc'
  isEstimated: boolean;
}

export function parseUnit(quantity: number | null, unitStr: string | undefined | null, isEstimated: boolean = false): NormalizedUnit {
  const amount = quantity ?? 1;
  const u = (unitStr || '').trim().toLowerCase();

  // Mass
  if (['kg', 'kilogram', 'kilograms', 'kilos'].includes(u)) {
    return { category: 'mass', standardValue: amount, standardUnit: 'kg', isEstimated };
  }
  if (['g', 'gram', 'grams'].includes(u)) {
    return { category: 'mass', standardValue: amount / 1000, standardUnit: 'kg', isEstimated };
  }
  if (['mg', 'milligram', 'milligrams'].includes(u)) {
    return { category: 'mass', standardValue: amount / 1000000, standardUnit: 'kg', isEstimated };
  }

  // Volume
  if (['l', 'liter', 'litre', 'liters', 'litres'].includes(u)) {
    return { category: 'volume', standardValue: amount, standardUnit: 'L', isEstimated };
  }
  if (['ml', 'milliliter', 'millilitre', 'milliliters'].includes(u)) {
    return { category: 'volume', standardValue: amount / 1000, standardUnit: 'L', isEstimated };
  }

  // Count
  if (['dz', 'dozen', 'dozens'].includes(u)) {
    return { category: 'count', standardValue: amount * 12, standardUnit: 'pc', isEstimated };
  }
  if (['pc', 'pcs', 'piece', 'pieces', 'ea', 'each', 'pack', 'pkt', 'packet'].includes(u) || u === '') {
    // Treat empty unit or generic packs as count, but careful: comparing packs can be tricky if sizes differ.
    // The prompt says: "For packaged items, compare only matching variants and pack sizes unless the user explicitly corrects their canonical identity."
    // We will treat these as 'count' and rely on canonical name matching for pack size consistency.
    return { category: 'count', standardValue: amount, standardUnit: 'pc', isEstimated };
  }

  return { category: 'unknown', standardValue: amount, standardUnit: u, isEstimated };
}

export function areUnitsCompatible(u1: NormalizedUnit, u2: NormalizedUnit): boolean {
  if (u1.category === 'unknown' || u2.category === 'unknown') {
    return u1.standardUnit === u2.standardUnit;
  }
  return u1.category === u2.category;
}

// In absence of a database alias table, we can provide a hook for it.
export function applyAlias(name: string): string {
  // basic normalization
  return name.replace(/\s+/g, ' ').trim();
}

export function getCanonicalItemName(name?: string, brand?: string, variant?: string): string {
  const parts = [brand, name, variant].filter(p => !!p).map(p => p!.trim());
  if (parts.length === 0) return 'Unknown Item';
  return applyAlias(parts.join(' ').toLowerCase());
}

export interface ItemObservation {
  receiptId: string;
  transactionDate: string;
  merchant: string;
  rawName: string;
  canonicalName: string;
  unit: NormalizedUnit;
  lineTotal: number;
  unitPrice: number; // calculated standard unit price
  isRefund: boolean;
}

export function extractObservations(receipts: ReceiptDocument[]): ItemObservation[] {
  const obs: ItemObservation[] = [];
  for (const r of receipts) {
    if (r.status !== 'confirmed' || !r.transactionDate) continue;
    
    const isReceiptRefund = (getReceiptTotal(r) ?? 0) < 0;

    for (const item of r.items) {
      const lineTotal = item.lineTotal;
      if (lineTotal == null) continue;
      
      const isRefund = isReceiptRefund || lineTotal < 0;
      const normalizedLineTotal = isRefund ? -Math.abs(lineTotal) : lineTotal;
      const quantityWasEstimated = item.quantity == null;
      const unit = parseUnit(item.quantity ?? null, item.unit ?? null, quantityWasEstimated);
      
      if (unit.standardValue === 0) continue; // Prevent division by zero
      if (normalizedLineTotal === 0 && item.unitPrice == null) continue;

      // A printed rate is authoritative even when a discount makes lineTotal / quantity
      // lower. Convert that rate to the normalized standard unit when necessary.
      const quantity = item.quantity ?? 1;
      const unitPrice = item.unitPrice != null
        ? item.unitPrice * (quantity / unit.standardValue)
        : normalizedLineTotal / unit.standardValue;
      if (!Number.isFinite(unitPrice)) continue;
      
      const canonicalName = getCanonicalItemName(item.name ?? item.rawLineText ?? '', item.brand ?? undefined);

      obs.push({
        receiptId: r.id,
        transactionDate: r.transactionDate,
        merchant: r.merchantNormalized || r.merchantRaw || 'Unknown',
        rawName: item.rawLineText || item.name || 'Unknown',
        canonicalName,
        unit,
        lineTotal: normalizedLineTotal,
        unitPrice,
        isRefund
      });
    }
  }
  return obs;
}

export interface ItemAnalytics {
  canonicalName: string;
  totalSpent: number;
  occasions: number;
  firstPurchase: string;
  lastPurchase: string;
  
  // Price stats (for comparable observations)
  minPrice: number | null;
  maxPrice: number | null;
  medianPrice: number | null;
  simpleAverage: number | null;
  weightedAverage: number | null;
  
  latestPrice: number | null;
  previousPrice: number | null;
  priceChangeAbs: number | null;
  priceChangePct: number | null;
  
  unitCategory: UnitCategory;
  standardUnit: string;

  observations: ItemObservation[]; // sorted by date asc
  merchants: { name: string; avgPrice: number; occasions: number }[];
}

export function analyzeItem(observations: ItemObservation[]): ItemAnalytics | null {
  if (observations.length === 0) return null;

  const allObservations = [...observations]
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
  // Refunds affect spend, but they are not purchase-price observations. Missing
  // quantities remain visible in spend totals without becoming invented rates.
  const strictObs = allObservations.filter(o => (
    !o.isRefund
    && !o.unit.isEstimated
    && o.unit.standardValue > 0
    && o.unitPrice > 0
  ));

  const totalSpent = allObservations.reduce((sum, o) => sum + o.lineTotal, 0);
  const totalStandardUnits = strictObs.reduce((sum, o) => sum + o.unit.standardValue, 0);
  const weightedAverage = totalStandardUnits > 0
    ? strictObs.reduce((sum, o) => sum + (o.unitPrice * o.unit.standardValue), 0)
      / totalStandardUnits
    : null;
  
  const prices = strictObs.map(o => o.unitPrice).sort((a, b) => a - b);
  const minPrice = prices.length > 0 ? prices[0] : null;
  const maxPrice = prices.length > 0 ? prices[prices.length - 1] : null;
  const simpleAverage = prices.length > 0
    ? prices.reduce((a, b) => a + b, 0) / prices.length
    : null;
  
  let medianPrice: number | null = null;
  if (prices.length > 0) {
    const mid = Math.floor(prices.length / 2);
    medianPrice = prices.length % 2 !== 0 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  }

  const latestObs = strictObs[strictObs.length - 1];
  const latestPrice = latestObs?.unitPrice ?? null;
  let previousPrice: number | null = null;
  let priceChangeAbs: number | null = null;
  let priceChangePct: number | null = null;

  if (latestObs && strictObs.length > 1) {
    const latestMonth = latestObs.transactionDate.substring(0, 7);
    // Find all observations in the most recent month PRIOR to latestMonth
    let priorMonth: string | null = null;
    for (let i = strictObs.length - 1; i >= 0; i--) {
      const obsMonth = strictObs[i].transactionDate.substring(0, 7);
      if (obsMonth < latestMonth) {
        if (priorMonth === null) priorMonth = obsMonth;
        if (obsMonth < priorMonth) break; // we went past the prior month we found
      }
    }

    if (priorMonth) {
      const priorMonthObs = strictObs.filter(o => o.transactionDate.substring(0, 7) === priorMonth);
      if (priorMonthObs.length > 0) {
        const pTotal = priorMonthObs.reduce(
          (sum, o) => sum + (o.unitPrice * o.unit.standardValue),
          0,
        );
        const pUnits = priorMonthObs.reduce((sum, o) => sum + o.unit.standardValue, 0);
        previousPrice = pUnits > 0 ? pTotal / pUnits : null;
        
        if (previousPrice !== null && latestPrice !== null) {
          priceChangeAbs = latestPrice - previousPrice;
          if (previousPrice !== 0) {
            priceChangePct = (priceChangeAbs / previousPrice) * 100;
          }
        }
      }
    }
  }

  // Merchant comparison
  const merchantMap = new Map<string, { totalSpend: number; totalUnits: number; occasions: number }>();
  for (const o of strictObs) {
    const curr = merchantMap.get(o.merchant) || { totalSpend: 0, totalUnits: 0, occasions: 0 };
    curr.totalSpend += o.unitPrice * o.unit.standardValue;
    curr.totalUnits += o.unit.standardValue;
    curr.occasions += 1;
    merchantMap.set(o.merchant, curr);
  }

  const merchants = Array.from(merchantMap.entries()).map(([name, data]) => ({
    name,
    avgPrice: data.totalUnits > 0 ? data.totalSpend / data.totalUnits : 0,
    occasions: data.occasions
  })).sort((a, b) => b.occasions - a.occasions);

  return {
    canonicalName: allObservations[0].canonicalName,
    totalSpent,
    occasions: allObservations.length,
    firstPurchase: allObservations[0].transactionDate,
    lastPurchase: allObservations[allObservations.length - 1].transactionDate,
    minPrice,
    maxPrice,
    medianPrice,
    simpleAverage,
    weightedAverage,
    latestPrice,
    previousPrice,
    priceChangeAbs,
    priceChangePct,
    unitCategory: allObservations[0].unit.category,
    standardUnit: allObservations[0].unit.standardUnit,
    observations: strictObs,
    merchants
  };
}

export function groupAndAnalyzeItems(receipts: ReceiptDocument[]): ItemAnalytics[] {
  const allObs = extractObservations(receipts);
  
  // Known units compare within their normalized category. Unknown units need
  // their exact normalized label as well, so boxes never mix with bottles.
  const groups = new Map<string, ItemObservation[]>();
  
  for (const o of allObs) {
    const unitKey = o.unit.category === 'unknown'
      ? `${o.unit.category}:${o.unit.standardUnit}`
      : o.unit.category;
    const key = `${o.canonicalName}::${unitKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }

  const analytics: ItemAnalytics[] = [];
  for (const obsList of groups.values()) {
    const res = analyzeItem(obsList);
    if (res) analytics.push(res);
  }

  return analytics.sort((a, b) => b.totalSpent - a.totalSpent);
}
