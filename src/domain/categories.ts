import { CategoryDocument, ReceiptDocument } from './schema';

export const DEFAULT_CATEGORIES = [
  'Groceries',
  'Meat',
  'Fruit & Vegetables',
  'Household',
  'Medicine',
  'Eating Out',
  'Miscellaneous',
] as const;

type ReceiptItem = ReceiptDocument['items'][number];

export function normalizeCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function normalizeMerchantName(value: string): string {
  return normalizeCategoryName(value);
}

export function categoryMatchesLegacyName(category: CategoryDocument, name: string | null | undefined): boolean {
  if (!name) return false;
  const normalized = normalizeCategoryName(name);
  return normalizeCategoryName(category.name) === normalized
    || (category.legacyNames ?? []).some(legacyName => normalizeCategoryName(legacyName) === normalized);
}

export function findCategoryForLegacyName(
  name: string | null | undefined,
  categories: CategoryDocument[],
): CategoryDocument | undefined {
  return categories.find(category => categoryMatchesLegacyName(category, name));
}

export function resolveReceiptItemCategoryId(item: ReceiptItem, categories: CategoryDocument[]): string | null {
  if (item.categoryId) return item.categoryId;
  return findCategoryForLegacyName(item.category, categories)?.id ?? null;
}

export function getCategoryLabel(
  categoryId: string | null | undefined,
  legacyName: string | null | undefined,
  categories: CategoryDocument[],
): string {
  if (categoryId) {
    return categories.find(category => category.id === categoryId)?.name ?? 'Deleted category';
  }
  return findCategoryForLegacyName(legacyName, categories)?.name ?? legacyName ?? 'Uncategorized';
}

export function getReceiptItemCategoryLabel(item: ReceiptItem, categories: CategoryDocument[]): string {
  return getCategoryLabel(item.categoryId, item.category, categories);
}

/**
 * New writes store only the stable category ID. The legacy display-name field
 * remains readable so historical receipts can be resolved without migration.
 */
export function canonicalizeReceiptItemCategory(item: ReceiptItem, categories: CategoryDocument[]): ReceiptItem {
  const categoryId = resolveReceiptItemCategoryId(item, categories);
  if (!categoryId) return item;

  const { category: _legacyCategory, ...withoutLegacyCategory } = item;
  return { ...withoutLegacyCategory, categoryId };
}

export function canonicalizeReceiptItemCategories(
  items: ReceiptItem[],
  categories: CategoryDocument[],
): ReceiptItem[] {
  return items.map(item => canonicalizeReceiptItemCategory(item, categories));
}

export function replaceReceiptItemCategory(
  item: ReceiptItem,
  oldCategory: CategoryDocument,
  replacementCategoryId: string,
): ReceiptItem {
  const referencesOldCategory = item.categoryId === oldCategory.id
    || (!item.categoryId && categoryMatchesLegacyName(oldCategory, item.category));
  if (!referencesOldCategory) return item;

  const { category: _legacyCategory, ...withoutLegacyCategory } = item;
  return { ...withoutLegacyCategory, categoryId: replacementCategoryId, userEdited: true };
}

export function applyMerchantCategoryAlias(
  items: ReceiptItem[],
  categoryId: string,
): ReceiptItem[] {
  return items.map(item => {
    // An alias is a review-time default, never an override of a human edit.
    if (item.userEdited) return item;
    const { category: _legacyCategory, ...withoutLegacyCategory } = item;
    return { ...withoutLegacyCategory, categoryId };
  });
}
