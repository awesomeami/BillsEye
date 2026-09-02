import type { CategoryDocument, ReceiptDocument } from './schema';
import { DEFAULT_CATEGORY_CATALOG } from './categoryCatalog';

export {
  CATEGORY_CATALOG_VERSION,
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_CATALOG,
} from './categoryCatalog';

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
  if (!name) return undefined;
  const normalized = normalizeCategoryName(name);
  // A visible category name always wins over a legacy compatibility name.
  // This prevents an old alias from shadowing a user-created category.
  return categories.find(category => normalizeCategoryName(category.name) === normalized)
    ?? categories.find(category => (category.legacyNames ?? []).some(
      legacyName => normalizeCategoryName(legacyName) === normalized,
    ));
}

export interface CategoryCatalogMigration {
  creates: CategoryDocument[];
  updates: Array<{
    id: string;
    data: Pick<CategoryDocument, 'name' | 'legacyNames'>;
  }>;
}

function withLegacyNames(existing: string[] | undefined, ...names: string[]): string[] {
  const result = [...(existing ?? [])];
  const seen = new Set(result.map(normalizeCategoryName));
  for (const name of names) {
    const trimmed = name.trim();
    const normalized = normalizeCategoryName(trimmed);
    if (trimmed && !seen.has(normalized)) {
      result.push(trimmed);
      seen.add(normalized);
    }
  }
  return result.slice(-20);
}

function sameStringList(left: string[] | undefined, right: string[]): boolean {
  return (left ?? []).length === right.length
    && (left ?? []).every((value, index) => value === right[index]);
}

/**
 * Plans a one-time, non-destructive upgrade from the original seven default
 * categories. User-renamed defaults retain their visible name; the new model
 * label is retained as a legacy alias so future AI suggestions still resolve.
 */
export function buildCategoryCatalogMigration(
  categories: CategoryDocument[],
  createdAt: string,
): CategoryCatalogMigration {
  const creates: CategoryDocument[] = [];
  const updates: CategoryCatalogMigration['updates'] = [];
  const categoryById = new Map(categories.map(category => [category.id, category]));
  const namesInUse = new Set(categories.map(category => normalizeCategoryName(category.name)));
  let nextOrder = Math.max(-1, ...categories.map(category => category.order)) + 1;

  for (const definition of DEFAULT_CATEGORY_CATALOG) {
    const existing = categoryById.get(definition.id);
    if (!existing) {
      if (namesInUse.has(normalizeCategoryName(definition.name))) continue;
      creates.push({
        id: definition.id,
        name: definition.name,
        legacyNames: definition.previousName ? [definition.previousName] : [],
        isCustom: false,
        createdAt,
        order: nextOrder++,
        isActive: true,
      });
      namesInUse.add(normalizeCategoryName(definition.name));
      continue;
    }

    const currentName = normalizeCategoryName(existing.name);
    const targetName = normalizeCategoryName(definition.name);
    const anotherCategoryUsesTargetName = categories.some(category =>
      category.id !== existing.id && normalizeCategoryName(category.name) === targetName,
    );
    let name = existing.name;
    let legacyNames = existing.legacyNames ?? [];

    if (
      definition.previousName
      && currentName === normalizeCategoryName(definition.previousName)
      && !anotherCategoryUsesTargetName
    ) {
      name = definition.name;
      legacyNames = withLegacyNames(legacyNames, existing.name);
    } else if (currentName !== targetName && !anotherCategoryUsesTargetName) {
      legacyNames = withLegacyNames(legacyNames, definition.name);
    }

    if (name !== existing.name || !sameStringList(existing.legacyNames, legacyNames)) {
      updates.push({ id: existing.id, data: { name, legacyNames } });
    }
  }

  return { creates, updates };
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
