import { ReceiptDocument } from '../../domain/schema';
import { getReceiptTotal } from '../../domain/reconciliation';
import { formatCurrency } from '../../utilities/config';

interface ReceiptTotalValueProps {
  receipt: Pick<ReceiptDocument, 'items' | 'printedSubtotal' | 'printedDiscount' | 'printedTax' | 'printedFees' | 'printedRounding' | 'printedGrandTotal'>;
  className?: string;
}

/** Renders the canonical receipt total without turning an unknown value into zero. */
export function ReceiptTotalValue({ receipt, className }: ReceiptTotalValueProps) {
  const total = getReceiptTotal(receipt);

  return (
    <span className={className} data-total-state={total == null ? 'unavailable' : 'available'}>
      {total == null ? 'Unavailable' : formatCurrency(total / 100)}
    </span>
  );
}
