import {
  AliasDocument,
  AppSettingsDocument,
  AppSettingsSchema,
  CategoryDocument,
  ReceiptDocument,
  ReceiptSchema,
  UserProfileDocument,
} from '../../src/domain/schema';

type ReceiptListener = (receipts: ReceiptDocument[]) => void;
type CategoryListener = (categories: CategoryDocument[]) => void;
type SettingsListener = (settings: AppSettingsDocument) => void;
type ReceiptMetadata = { fromCache: boolean; hasPendingWrites: boolean };

function subscribeToReceiptMetadata(source: 'confirmed' | 'pending', onMetadata?: (metadata: ReceiptMetadata) => void) {
  onMetadata?.({ fromCache: false, hasPendingWrites: false });
  const handleMetadata = (event: Event) => {
    const detail = (event as CustomEvent<ReceiptMetadata & { source: string }>).detail;
    if (detail.source === source) onMetadata?.({ fromCache: detail.fromCache, hasPendingWrites: detail.hasPendingWrites });
  };
  window.addEventListener('kharchalens:e2e-receipt-metadata', handleMetadata);
  return () => window.removeEventListener('kharchalens:e2e-receipt-metadata', handleMetadata);
}

export class ReceiptRevisionConflictError extends Error {
  readonly code = 'receipt-revision-conflict';

  constructor() {
    super('Conflict: Receipt was updated by another device.');
    this.name = 'ReceiptRevisionConflictError';
  }
}

function shouldForceReceiptConflict(): boolean {
  const target = globalThis as typeof globalThis & { __E2E_FORCE_RECEIPT_CONFLICT__?: boolean };
  if (!target.__E2E_FORCE_RECEIPT_CONFLICT__) return false;
  target.__E2E_FORCE_RECEIPT_CONFLICT__ = false;
  return true;
}

const receiptsByUser = new Map<string, Map<string, ReceiptDocument>>();
const categoriesByUser = new Map<string, Map<string, CategoryDocument>>();
const aliasesByUser = new Map<string, Map<string, AliasDocument>>();
const settingsByUser = new Map<string, AppSettingsDocument>();
const profilesByUser = new Map<string, UserProfileDocument>();
const receiptListeners = new Map<string, Set<ReceiptListener>>();
const pendingReceiptListeners = new Map<string, Set<ReceiptListener>>();
const categoryListeners = new Map<string, Set<CategoryListener>>();
const settingsListeners = new Map<string, Set<SettingsListener>>();

function userMap<T>(source: Map<string, Map<string, T>>, uid: string): Map<string, T> {
  let map = source.get(uid);
  if (!map) {
    map = new Map<string, T>();
    source.set(uid, map);
  }
  return map;
}

function currentReceipts(uid: string, status: ReceiptDocument['status']): ReceiptDocument[] {
  return [...userMap(receiptsByUser, uid).values()]
    .filter(receipt => receipt.status === status)
    .sort((left, right) => (right.transactionDate ?? right.createdAt).localeCompare(left.transactionDate ?? left.createdAt));
}

function emitReceipts(uid: string) {
  receiptListeners.get(uid)?.forEach(listener => listener(currentReceipts(uid, 'confirmed')));
  pendingReceiptListeners.get(uid)?.forEach(listener => listener(currentReceipts(uid, 'pendingReview')));
}

function seedPerformanceReceipts(uid: string, count: number) {
  const receipts = userMap(receiptsByUser, uid);
  for (let index = 0; index < count; index += 1) {
    const id = `performance-receipt-${index}`;
    receipts.set(id, ReceiptSchema.parse({
      id,
      revision: 1,
      status: 'confirmed',
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
      confirmedAt: '2026-08-28T00:00:00.000Z',
      merchantRaw: `Performance Merchant ${String(index).padStart(3, '0')}`,
      merchantNormalized: `Performance Merchant ${String(index).padStart(3, '0')}`,
      transactionDate: `2026-08-${String((index % 28) + 1).padStart(2, '0')}`,
      currency: 'PKR',
      paymentMethod: index % 2 === 0 ? 'Card' : 'Cash',
      items: Array.from({ length: 4 }, (_, itemIndex) => ({
        id: `${id}-item-${itemIndex}`,
        rawLineText: `Fixture line ${itemIndex} for receipt ${index}`,
        name: `Fixture item ${itemIndex}`,
        quantity: 1,
        unitPrice: 2500 + index,
        lineTotal: 2500 + index,
        category: 'Groceries',
      })),
      printedGrandTotal: 10_000 + (index * 4),
      rawOcrText: `Performance fixture ${index} `.repeat(30),
    }));
  }
  emitReceipts(uid);
}

function seedTrendReceipts(uid: string, points: Array<{ date: string; total: number }>) {
  const receipts = userMap(receiptsByUser, uid);
  receipts.clear();
  points.forEach((point, index) => {
    const id = `trend-receipt-${index}`;
    receipts.set(id, ReceiptSchema.parse({
      id,
      revision: 1,
      status: 'confirmed',
      createdAt: `${point.date}T00:00:00.000Z`,
      updatedAt: `${point.date}T00:00:00.000Z`,
      confirmedAt: `${point.date}T00:00:00.000Z`,
      merchantRaw: `Trend Merchant ${index}`,
      merchantNormalized: `Trend Merchant ${index}`,
      transactionDate: point.date,
      currency: 'PKR',
      items: [],
      printedGrandTotal: point.total,
      rawOcrText: `Trend fixture ${index}`,
    }));
  });
  emitReceipts(uid);
}

if (typeof window !== 'undefined') {
  const target = window as typeof window & {
    __KHARCHALENS_E2E_SEED_RECEIPTS__?: (count: number) => void;
    __KHARCHALENS_E2E_SEED_TREND__?: (points: Array<{ date: string; total: number }>) => void;
  };
  target.__KHARCHALENS_E2E_SEED_RECEIPTS__ = count => seedPerformanceReceipts('e2e-user', count);
  target.__KHARCHALENS_E2E_SEED_TREND__ = points => seedTrendReceipts('e2e-user', points);
}

function subscribe<T>(listeners: Map<string, Set<(value: T) => void>>, uid: string, listener: (value: T) => void, value: T) {
  const userListeners = listeners.get(uid) ?? new Set<(value: T) => void>();
  userListeners.add(listener);
  listeners.set(uid, userListeners);
  listener(value);
  return () => userListeners.delete(listener);
}

function emitCategories(uid: string) {
  const categories = [...userMap(categoriesByUser, uid).values()].sort((left, right) => left.order - right.order);
  categoryListeners.get(uid)?.forEach(listener => listener(categories));
}

function currentSettings(uid: string): AppSettingsDocument {
  const settings = settingsByUser.get(uid) ?? AppSettingsSchema.parse({});
  settingsByUser.set(uid, settings);
  return settings;
}

function emitSettings(uid: string) {
  const settings = currentSettings(uid);
  settingsListeners.get(uid)?.forEach(listener => listener(settings));
}

function categoryId(name: string) {
  return `cat_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`;
}

export const userRepository = {
  async getOrCreateProfile(uid: string, email: string, displayName?: string | null): Promise<UserProfileDocument> {
    const existing = profilesByUser.get(uid);
    if (existing) return existing;
    const now = new Date().toISOString();
    const profile: UserProfileDocument = { email, displayName: displayName ?? email, createdAt: now, lastLoginAt: now, schemaVersion: 1 };
    profilesByUser.set(uid, profile);
    return profile;
  },
  async seedDefaultCategories(): Promise<void> {},
};

export const receiptRepository = {
  subscribeToReceipts(
    uid: string,
    onUpdate: ReceiptListener,
    _onError: (error: Error) => void,
    onMetadata?: (metadata: { fromCache: boolean; hasPendingWrites: boolean }) => void,
  ) {
    const unsubscribeMetadata = subscribeToReceiptMetadata('confirmed', onMetadata);
    const unsubscribe = subscribe(receiptListeners, uid, onUpdate, currentReceipts(uid, 'confirmed'));
    return () => { unsubscribeMetadata(); unsubscribe(); };
  },
  subscribeToPendingReceipts(
    uid: string,
    onUpdate: ReceiptListener,
    _onError: (error: Error) => void,
    onMetadata?: (metadata: { fromCache: boolean; hasPendingWrites: boolean }) => void,
  ) {
    const unsubscribeMetadata = subscribeToReceiptMetadata('pending', onMetadata);
    const unsubscribe = subscribe(pendingReceiptListeners, uid, onUpdate, currentReceipts(uid, 'pendingReview'));
    return () => { unsubscribeMetadata(); unsubscribe(); };
  },
  async getReceipts(uid: string): Promise<ReceiptDocument[]> {
    return [...userMap(receiptsByUser, uid).values()];
  },
  async getReceipt(uid: string, receiptId: string): Promise<ReceiptDocument | null> {
    return userMap(receiptsByUser, uid).get(receiptId) ?? null;
  },
  async createReceipt(uid: string, receipt: ReceiptDocument): Promise<void> {
    userMap(receiptsByUser, uid).set(receipt.id, receipt);
    emitReceipts(uid);
  },
  async updateReceipt(uid: string, receiptId: string, update: Partial<ReceiptDocument>, currentVersion?: number): Promise<ReceiptDocument> {
    const current = userMap(receiptsByUser, uid).get(receiptId);
    if (!current) throw new Error('Receipt no longer exists.');
    if (shouldForceReceiptConflict()) {
      userMap(receiptsByUser, uid).set(receiptId, {
        ...current,
        merchantRaw: 'Remote update',
        revision: current.revision + 1,
      });
      emitReceipts(uid);
      throw new ReceiptRevisionConflictError();
    }
    if (currentVersion !== undefined && currentVersion !== current.revision) {
      throw new ReceiptRevisionConflictError();
    }
    const status = update.status ?? current.status;
    const updated = ReceiptSchema.parse({
      ...current,
      ...update,
      status,
      confirmedAt: status === 'confirmed' ? update.confirmedAt ?? current.confirmedAt ?? new Date().toISOString() : update.confirmedAt ?? current.confirmedAt,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    });
    userMap(receiptsByUser, uid).set(receiptId, updated);
    emitReceipts(uid);
    return updated;
  },
  async deleteReceipt(uid: string, receiptId: string): Promise<void> {
    userMap(receiptsByUser, uid).delete(receiptId);
    emitReceipts(uid);
  },
  async findByHash(uid: string, sha256: string): Promise<ReceiptDocument[]> {
    return [...userMap(receiptsByUser, uid).values()].filter(receipt => receipt.sourceSha256 === sha256);
  },
  async findPossibleDuplicates(uid: string, merchant: string, date: string, total: number | null): Promise<ReceiptDocument[]> {
    return [...userMap(receiptsByUser, uid).values()].filter(receipt =>
      receipt.merchantNormalized === merchant && receipt.transactionDate === date && receipt.printedGrandTotal === total,
    );
  },
};

export const categoryRepository = {
  subscribeToCategories(uid: string, onUpdate: CategoryListener, _onError: (error: Error) => void) {
    return subscribe(categoryListeners, uid, onUpdate, [...userMap(categoriesByUser, uid).values()]);
  },
  async addCategory(uid: string, name: string, isCustom = true): Promise<string> {
    const id = categoryId(name);
    const categories = userMap(categoriesByUser, uid);
    categories.set(id, { id, name, legacyNames: [], isCustom, createdAt: new Date().toISOString(), order: categories.size, isActive: true });
    emitCategories(uid);
    return id;
  },
  async renameCategory(uid: string, id: string, name: string): Promise<void> {
    const category = userMap(categoriesByUser, uid).get(id);
    if (!category) throw new Error('Category no longer exists.');
    userMap(categoriesByUser, uid).set(id, { ...category, name, legacyNames: [...(category.legacyNames ?? []), category.name] });
    emitCategories(uid);
  },
  async updateCategory(uid: string, id: string, update: Partial<CategoryDocument>): Promise<void> {
    const category = userMap(categoriesByUser, uid).get(id);
    if (!category) throw new Error('Category no longer exists.');
    userMap(categoriesByUser, uid).set(id, { ...category, ...update });
    emitCategories(uid);
  },
  async getReferenceCounts(): Promise<{ receiptItems: number; aliases: number }> {
    return { receiptItems: 0, aliases: 0 };
  },
  async replaceCategory(): Promise<void> {},
  async deleteCategory(uid: string, id: string): Promise<void> {
    userMap(categoriesByUser, uid).delete(id);
    emitCategories(uid);
  },
};

export const aliasRepository = {
  async getAliases(uid: string): Promise<AliasDocument[]> {
    return [...userMap(aliasesByUser, uid).values()];
  },
  subscribeToAliases(uid: string, onUpdate: (aliases: AliasDocument[]) => void, _onError: (error: Error) => void) {
    onUpdate([...userMap(aliasesByUser, uid).values()]);
    return () => undefined;
  },
  async getAliasForMerchant(uid: string, merchant: string): Promise<AliasDocument | null> {
    return [...userMap(aliasesByUser, uid).values()].find(alias => alias.merchantNormalized === merchant) ?? null;
  },
  async setAlias(uid: string, merchantNormalized: string, categoryId: string): Promise<void> {
    const id = `alias_${merchantNormalized.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    const now = new Date().toISOString();
    const existing = userMap(aliasesByUser, uid).get(id);
    userMap(aliasesByUser, uid).set(id, { id, merchantNormalized, categoryId, createdAt: existing?.createdAt ?? now, updatedAt: now });
  },
  async deleteAlias(uid: string, aliasId: string): Promise<void> {
    userMap(aliasesByUser, uid).delete(aliasId);
  },
};

export const settingsRepository = {
  async getSettings(uid: string): Promise<AppSettingsDocument> {
    return currentSettings(uid);
  },
  async updateSettings(uid: string, update: Partial<AppSettingsDocument>): Promise<void> {
    settingsByUser.set(uid, AppSettingsSchema.parse({ ...currentSettings(uid), ...update }));
    emitSettings(uid);
  },
  subscribeToSettings(uid: string, onUpdate: SettingsListener, _onError: (error: Error) => void) {
    return subscribe(settingsListeners, uid, onUpdate, currentSettings(uid));
  },
};
