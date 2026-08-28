import { parseMajorToMinor } from '../../domain/money';
import { ReceiptDocument } from '../../domain/schema';

export const RECEIPT_MONEY_FIELDS = [
  'printedSubtotal',
  'printedDiscount',
  'printedTax',
  'printedFees',
  'printedRounding',
  'printedGrandTotal',
] as const;

export type ReceiptMoneyField = typeof RECEIPT_MONEY_FIELDS[number];
export type ItemMoneyField = 'unitPrice' | 'lineTotal';
export type MoneyTextState = Record<string, string>;
export type MoneyValidationErrors = Record<string, string>;

export const receiptMoneyKey = (field: ReceiptMoneyField) => `receipt:${field}`;
export const itemMoneyKey = (itemId: string, field: ItemMoneyField) => `item:${itemId}:${field}`;

export function parseEditableMinor(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  try {
    return parseMajorToMinor(text);
  } catch {
    return undefined;
  }
}

export function materializeReceiptMoneyText(
  draft: Partial<ReceiptDocument>,
  moneyText: MoneyTextState,
): { draft: Partial<ReceiptDocument> | null; errors: MoneyValidationErrors } {
  const next: Partial<ReceiptDocument> = {
    ...draft,
    items: draft.items?.map((item) => ({ ...item })),
  };
  const errors: MoneyValidationErrors = {};

  for (const [key, text] of Object.entries(moneyText)) {
    const value = parseEditableMinor(text);
    if (value === undefined) {
      errors[key] = 'Enter a valid amount.';
      continue;
    }

    if (key.startsWith('receipt:')) {
      const field = key.substring('receipt:'.length) as ReceiptMoneyField;
      if ((RECEIPT_MONEY_FIELDS as readonly string[]).includes(field)) {
        next[field] = value;
      }
      continue;
    }

    const itemMatch = /^item:([^:]+):(unitPrice|lineTotal)$/.exec(key);
    if (!itemMatch || !next.items) continue;
    const [, itemId, field] = itemMatch;
    const item = next.items.find((candidate) => candidate.id === itemId);
    if (item) item[field] = value;
  }

  return Object.keys(errors).length > 0 ? { draft: null, errors } : { draft: next, errors };
}

export function isReceiptEditorDirty(
  baseline: Partial<ReceiptDocument> | null,
  draft: Partial<ReceiptDocument>,
  moneyText: MoneyTextState,
): boolean {
  return baseline == null
    || Object.keys(moneyText).length > 0
    || JSON.stringify(baseline) !== JSON.stringify(draft);
}

export function shouldBlockReceiptNavigation(
  isDirty: boolean,
  isSaving: boolean,
  currentPathname: string,
  nextPathname: string,
): boolean {
  return isDirty && !isSaving && currentPathname !== nextPathname;
}

export function isReceiptRevisionConflict(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === 'receipt-revision-conflict';
}

export function applyAuthoritativeReceiptSave(saved: ReceiptDocument): {
  receipt: ReceiptDocument;
  draft: Partial<ReceiptDocument>;
  baseline: Partial<ReceiptDocument>;
  moneyText: MoneyTextState;
} {
  const draft = { ...saved, items: saved.items.map((item) => ({ ...item })) };
  return { receipt: saved, draft, baseline: draft, moneyText: {} };
}
