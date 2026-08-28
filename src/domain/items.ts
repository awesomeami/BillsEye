import { ReceiptDocument } from './schema';

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
    
    // Skip refunds entirely for price analytics? Or mark them?
    // "Handle refunds/negative receipts explicitly."
    const isReceiptRefund = (r.printedGrandTotal ?? 0) < 0;

    for (const item of r.items) {
      const lineTotal = item.lineTotal;
      if (lineTotal == null) continue;
      
      const isRefund = isReceiptRefund || lineTotal < 0;
      if (isRefund) continue; // For now, we skip refunds for pricing analytics to avoid skewed averages

      const unit = parseUnit(item.quantity ?? null, item.unit ?? null, false);
      
      if (unit.standardValue === 0) continue; // Prevent division by zero
      if (lineTotal === 0) continue; // Ignore zero price items (freebies)

      // Calculate unit price per standard unit (e.g. per kg, per L, per piece)
      const unitPrice = lineTotal / unit.standardValue;
      
      const canonicalName = getCanonicalItemName(item.name ?? item.rawLineText ?? '', item.brand ?? undefined);

      obs.push({
        receiptId: r.id,
        transactionDate: r.transactionDate,
        merchant: r.merchantNormalized || r.merchantRaw || 'Unknown',
        rawName: item.rawLineText || item.name || 'Unknown',
        canonicalName,
        unit,
        lineTotal,
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
  minPrice: number;
  maxPrice: number;
  medianPrice: number;
  simpleAverage: number;
  weightedAverage: number;
  
  latestPrice: number;
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

  // Filter out estimated quantities for strict price comparisons
  const strictObs = observations.filter(o => !o.unit.isEstimated);
  if (strictObs.length === 0) return null; // No comparable observations

  // Sort by date ASC
  strictObs.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

  const totalSpent = strictObs.reduce((sum, o) => sum + o.lineTotal, 0);
  const totalStandardUnits = strictObs.reduce((sum, o) => sum + o.unit.standardValue, 0);
  const weightedAverage = totalStandardUnits > 0 ? totalSpent / totalStandardUnits : 0;
  
  const prices = strictObs.map(o => o.unitPrice).sort((a, b) => a - b);
  const minPrice = prices[0];
  const maxPrice = prices[prices.length - 1];
  const simpleAverage = prices.reduce((a, b) => a + b, 0) / prices.length;
  
  let medianPrice = 0;
  if (prices.length > 0) {
    const mid = Math.floor(prices.length / 2);
    medianPrice = prices.length % 2 !== 0 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  }

  const latestObs = strictObs[strictObs.length - 1];
  const latestPrice = latestObs.unitPrice;
  let previousPrice: number | null = null;
  let priceChangeAbs: number | null = null;
  let priceChangePct: number | null = null;

  if (strictObs.length > 1) {
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
        const pTotal = priorMonthObs.reduce((sum, o) => sum + o.lineTotal, 0);
        const pUnits = priorMonthObs.reduce((sum, o) => sum + o.unit.standardValue, 0);
        previousPrice = pUnits > 0 ? pTotal / pUnits : null;
        
        if (previousPrice !== null) {
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
    curr.totalSpend += o.lineTotal;
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
    canonicalName: strictObs[0].canonicalName,
    totalSpent,
    occasions: strictObs.length,
    firstPurchase: strictObs[0].transactionDate,
    lastPurchase: latestObs.transactionDate,
    minPrice,
    maxPrice,
    medianPrice,
    simpleAverage,
    weightedAverage,
    latestPrice,
    previousPrice,
    priceChangeAbs,
    priceChangePct,
    unitCategory: strictObs[0].unit.category,
    standardUnit: strictObs[0].unit.standardUnit,
    observations: strictObs,
    merchants
  };
}

export function groupAndAnalyzeItems(receipts: ReceiptDocument[]): ItemAnalytics[] {
  const allObs = extractObservations(receipts);
  
  // Group by canonical name AND unit category (to prevent mixing compatible vs incompatible units if canonical name matches but units are completely different)
  const groups = new Map<string, ItemObservation[]>();
  
  for (const o of allObs) {
    // We group by canonical name AND unit category to avoid comparing 'kg' with 'pcs' for the same product name
    const key = `${o.canonicalName}::${o.unit.category}`;
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
