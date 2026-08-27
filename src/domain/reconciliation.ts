import { ReceiptDocument } from './schema';

export interface ReconciliationResult {
  computedLineTotal: number | null;
  computedExpectedTotal: number | null;
  discrepancy: number | null;
  reconciliationStatus: 'matched' | 'mismatched' | 'unknown';
  warnings: string[];
}

export function reconcileReceipt(
  items: Array<{ lineTotal?: number | null }>,
  totals: {
    printedSubtotal?: number | null;
    printedDiscount?: number | null;
    printedTax?: number | null;
    printedFees?: number | null;
    printedRounding?: number | null;
    printedGrandTotal?: number | null;
  },
  discrepancyTolerance: number = 0
): ReconciliationResult {
  const warnings: string[] = [];
  
  // 1. Calculate sum of items
  let computedLineTotal: number | null = null;
  let hasUnknownLines = false;
  
  for (const item of items) {
    if (item.lineTotal != null) {
      if (computedLineTotal === null) {
        computedLineTotal = 0;
      }
      computedLineTotal += item.lineTotal;
    } else {
      hasUnknownLines = true;
    }
  }

  // 2. Determine base for expected total calculation
  let baseAmount: number | null = null;
  
  if (computedLineTotal != null && !hasUnknownLines) {
    baseAmount = computedLineTotal;
  } else if (totals.printedSubtotal != null) {
    baseAmount = totals.printedSubtotal;
    if (hasUnknownLines) {
      warnings.push("Using printed subtotal because some item totals are missing.");
    }
  } else if (computedLineTotal != null) {
     baseAmount = computedLineTotal;
     warnings.push("Using partial sum of item totals because some are missing and no subtotal is printed.");
  }
  
  // 3. Compute expected total
  let computedExpectedTotal: number | null = null;
  
  if (baseAmount != null) {
    computedExpectedTotal = baseAmount;
    
    // Explicit policy: printedDiscount is treated as a subtraction regardless of sign
    if (totals.printedDiscount != null) {
      computedExpectedTotal -= Math.abs(totals.printedDiscount);
    }
    
    // Add additions
    if (totals.printedTax != null) {
      computedExpectedTotal += totals.printedTax;
    }
    
    if (totals.printedFees != null) {
      computedExpectedTotal += totals.printedFees;
    }
    
    // Rounding can be addition or subtraction, preserve sign
    if (totals.printedRounding != null) {
      computedExpectedTotal += totals.printedRounding;
    }
  }

  // 4. Compare with printed grand total
  let discrepancy: number | null = null;
  let reconciliationStatus: 'matched' | 'mismatched' | 'unknown' = 'unknown';
  
  if (computedExpectedTotal != null && totals.printedGrandTotal != null) {
    discrepancy = computedExpectedTotal - totals.printedGrandTotal;
    
    if (Math.abs(discrepancy) <= discrepancyTolerance) {
      reconciliationStatus = 'matched';
    } else {
      reconciliationStatus = 'mismatched';
      warnings.push(`Expected total (${computedExpectedTotal}) does not match printed total (${totals.printedGrandTotal}).`);
    }
  }

  return {
    computedLineTotal,
    computedExpectedTotal,
    discrepancy,
    reconciliationStatus,
    warnings
  };
}
