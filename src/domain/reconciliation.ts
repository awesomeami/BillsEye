import { ReceiptDocument } from './schema'

export type ReconciliationStatus = 'matched' | 'mismatched' | 'unknown'
export type SubtotalSource = 'items' | 'printed_subtotal' | 'unavailable'
export type DiscrepancyDirection = 'printed_higher' | 'calculated_higher' | 'none' | 'unknown'

export interface ReceiptTotalFields {
  printedSubtotal?: number | null
  printedDiscount?: number | null
  printedTax?: number | null
  printedFees?: number | null
  printedRounding?: number | null
  printedGrandTotal?: number | null
}

type ReceiptLineItem = { lineTotal?: number | null }

export interface ReconciliationResult {
  /** Sum of every line item only when every item has a numeric line total. */
  computedLineTotal: number | null
  /** The subtotal used to calculate the expected total. */
  baseSubtotal: number | null
  subtotalSource: SubtotalSource
  /** A discount is always represented as a negative adjustment. */
  normalizedDiscount: number
  /** subtotal + discount + tax + fees + rounding, when the subtotal is known. */
  computedExpectedTotal: number | null
  /** Printed grand total when present; otherwise the calculated expected total. */
  effectiveTotal: number | null
  /** Printed grand total minus calculated expected total. */
  discrepancy: number | null
  discrepancyDirection: DiscrepancyDirection
  reconciliationStatus: ReconciliationStatus
  warnings: string[]
}

/**
 * Converts a stored receipt discount to the one domain representation used by
 * totals: a negative adjustment. Historical imports may contain either sign.
 */
export function normalizeDiscount(discount: number | null | undefined): number {
  return discount == null ? 0 : -Math.abs(discount)
}

export function getDiscrepancyLabel(direction: DiscrepancyDirection): string {
  switch (direction) {
    case 'printed_higher':
      return 'Printed total is higher than calculated total'
    case 'calculated_higher':
      return 'Calculated total is higher than printed total'
    case 'none':
      return 'Printed and calculated totals match'
    default:
      return 'Total comparison unavailable'
  }
}

/**
 * Calculates every receipt total in minor currency units.
 *
 * The subtotal is the complete line-item sum, falling back only to a printed
 * subtotal. Missing tax, fees, and rounding are zero adjustments; rounding
 * preserves its sign. Discounts are normalized once to a negative adjustment.
 * A line-item subtotal is known only when every line item has a numeric total,
 * so partial line-item sums are intentionally never presented as complete.
 */
export function calculateReceiptTotals(
  items: ReadonlyArray<ReceiptLineItem> | null | undefined,
  totals: ReceiptTotalFields,
  discrepancyTolerance = 0,
): ReconciliationResult {
  const warnings: string[] = []
  const receiptItems = items ?? []
  const hasItems = receiptItems.length > 0
  const hasUnknownLines = receiptItems.some((item) => item.lineTotal == null)
  const computedLineTotal = hasItems && !hasUnknownLines
    ? receiptItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0)
    : null

  let baseSubtotal: number | null = null
  let subtotalSource: SubtotalSource = 'unavailable'

  if (computedLineTotal != null) {
    baseSubtotal = computedLineTotal
    subtotalSource = 'items'
  } else if (totals.printedSubtotal != null) {
    baseSubtotal = totals.printedSubtotal
    subtotalSource = 'printed_subtotal'
  } else if (hasItems && hasUnknownLines) {
    warnings.push('Some line item totals are unavailable, and no printed subtotal was provided.')
  } else {
    warnings.push('No line item totals or printed subtotal were provided.')
  }

  const normalizedDiscount = normalizeDiscount(totals.printedDiscount)
  const tax = totals.printedTax ?? 0
  const fees = totals.printedFees ?? 0
  const rounding = totals.printedRounding ?? 0
  const computedExpectedTotal = baseSubtotal == null
    ? null
    : baseSubtotal + normalizedDiscount + tax + fees + rounding
  const printedGrandTotal = totals.printedGrandTotal ?? null
  const effectiveTotal = printedGrandTotal ?? computedExpectedTotal

  if (printedGrandTotal == null) {
    warnings.push('Printed grand total is unavailable.')
  }

  if (computedExpectedTotal == null) {
    warnings.push('Calculated grand total is unavailable.')
    return {
      computedLineTotal,
      baseSubtotal,
      subtotalSource,
      normalizedDiscount,
      computedExpectedTotal,
      effectiveTotal,
      discrepancy: null,
      discrepancyDirection: 'unknown',
      reconciliationStatus: 'unknown',
      warnings,
    }
  }

  if (printedGrandTotal == null) {
    return {
      computedLineTotal,
      baseSubtotal,
      subtotalSource,
      normalizedDiscount,
      computedExpectedTotal,
      effectiveTotal,
      discrepancy: null,
      discrepancyDirection: 'unknown',
      reconciliationStatus: 'unknown',
      warnings,
    }
  }

  const discrepancy = printedGrandTotal - computedExpectedTotal
  const tolerance = Math.max(0, discrepancyTolerance)
  const reconciliationStatus: ReconciliationStatus = Math.abs(discrepancy) <= tolerance
    ? 'matched'
    : 'mismatched'
  const discrepancyDirection: DiscrepancyDirection = reconciliationStatus === 'matched'
    ? 'none'
    : discrepancy > 0
      ? 'printed_higher'
      : 'calculated_higher'

  if (reconciliationStatus === 'mismatched') {
    warnings.push(getDiscrepancyLabel(discrepancyDirection))
  }

  return {
    computedLineTotal,
    baseSubtotal,
    subtotalSource,
    normalizedDiscount,
    computedExpectedTotal,
    effectiveTotal,
    discrepancy,
    discrepancyDirection,
    reconciliationStatus,
    warnings,
  }
}

/** Returns the canonical receipt total for displays, analytics, and exports. */
export function getReceiptTotal(receipt: Pick<ReceiptDocument, 'items' | 'printedSubtotal' | 'printedDiscount' | 'printedTax' | 'printedFees' | 'printedRounding' | 'printedGrandTotal'>): number | null {
  return calculateReceiptTotals(receipt.items, receipt).effectiveTotal
}

/** @deprecated Use calculateReceiptTotals for new code. */
export const reconcileReceipt = calculateReceiptTotals
