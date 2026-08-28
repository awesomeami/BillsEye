import { z } from 'zod';
import {
  AliasDocument,
  AliasSchema,
  AppSettingsDocument,
  AppSettingsSchema,
  CategoryDocument,
  CategorySchema,
  ReceiptDocument,
  ReceiptWriteSchema,
  UserProfileDocument,
  UserProfileSchema,
} from '../../domain/schema';

const MAX_BACKUP_BYTES = 10 * 1024 * 1024; // 10MB
const SENSITIVE_KEY_FIELDS = new Set([
  'key', 'apikey', 'geminikey', 'geminiapikey',
  'ciphertextbase64', 'ivbase64', 'saltbase64', 'passphrase', 'authorization'
]);

const isSensitiveKeyField = (field: string) => SENSITIVE_KEY_FIELDS.has(field.toLowerCase());

const BACKUP_VERSION = 2;

const BackupIntegritySchema = z.object({
  algorithm: z.literal('SHA-256'),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const BackupContentsSchema = z.object({
  profile: UserProfileSchema.strict().nullable(),
  receipts: z.array(ReceiptWriteSchema),
  categories: z.array(CategorySchema.strict()),
  aliases: z.array(AliasSchema.strict()),
  settings: AppSettingsSchema.strict().nullable(),
}).strict();

const BackupEnvelopeSchema = BackupContentsSchema.extend({
  version: z.literal(BACKUP_VERSION),
  timestamp: z.string().datetime(),
  integrity: BackupIntegritySchema,
}).strict();

export interface BackupContents {
  profile: UserProfileDocument | null;
  receipts: ReceiptDocument[];
  categories: CategoryDocument[];
  aliases: AliasDocument[];
  settings: AppSettingsDocument | null;
}

export interface BackupEnvelope extends BackupContents {
  version: typeof BACKUP_VERSION;
  timestamp: string;
  integrity: {
    algorithm: 'SHA-256';
    digest: string;
  };
}

export interface RestoreRecordCounts {
  new: number;
  overwritten: number;
  unchanged: number;
}

const utf8Length = (value: string) => new TextEncoder().encode(value).byteLength;

function isRawImageBase64(value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return false;
  try {
    const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
    return (
      (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
      || (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      || (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
      || (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
    );
  } catch {
    return false;
  }
}

function normalizeTimestamp(value: unknown): unknown {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid timestamp in backup data.');
    return value.toISOString();
  }

  if (value && typeof value === 'object') {
    const candidate = value as {
      toDate?: () => Date;
      seconds?: unknown;
      nanoseconds?: unknown;
    };
    if (typeof candidate.toDate === 'function') return normalizeTimestamp(candidate.toDate());
    if (typeof candidate.seconds === 'number') {
      const nanoseconds = typeof candidate.nanoseconds === 'number' ? candidate.nanoseconds : 0;
      const date = new Date(candidate.seconds * 1000 + nanoseconds / 1_000_000);
      if (Number.isNaN(date.getTime())) throw new Error('Invalid timestamp in backup data.');
      return date.toISOString();
    }
  }
  return value;
}

function normalizeTimestamps(value: unknown): unknown {
  const normalized = normalizeTimestamp(value);
  if (normalized !== value) return normalized;
  if (Array.isArray(value)) return value.map(normalizeTimestamps);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, normalizeTimestamps(nested)]),
    );
  }
  return value;
}

function assertSafeValues(value: unknown, path = 'backup'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeValues(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKeyField(key)) {
        throw new Error(`Backup contains prohibited key material at ${path}.${key}.`);
      }
      assertSafeValues(nested, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && value.trimStart().toLowerCase().startsWith('data:')) {
    throw new Error(`Backup contains data-URL content at ${path}. Images are not supported in backups.`);
  }
  if (typeof value === 'string' && isRawImageBase64(value)) {
    throw new Error(`Backup contains encoded image content at ${path}. Images are not supported in backups.`);
  }
}

function formatZodError(error: z.ZodError): string {
  const firstIssue = error.issues[0];
  return firstIssue
    ? `Invalid backup data at ${firstIssue.path.join('.') || 'root'}: ${firstIssue.message}`
    : 'Invalid backup data.';
}

function parseBackupContents(input: unknown): BackupContents {
  const parsed = BackupContentsSchema.safeParse(normalizeTimestamps(input));
  if (!parsed.success) throw new Error(formatZodError(parsed.error));
  const asIsoTimestamp = (value: string, path: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp in backup data at ${path}.`);
    return date.toISOString();
  };
  return {
    profile: parsed.data.profile
      ? {
        ...parsed.data.profile,
        createdAt: asIsoTimestamp(parsed.data.profile.createdAt, 'profile.createdAt'),
        lastLoginAt: asIsoTimestamp(parsed.data.profile.lastLoginAt, 'profile.lastLoginAt'),
      }
      : null,
    receipts: parsed.data.receipts.map(receipt => ({
      ...receipt,
      createdAt: asIsoTimestamp(receipt.createdAt, `receipts.${receipt.id}.createdAt`),
      updatedAt: asIsoTimestamp(receipt.updatedAt, `receipts.${receipt.id}.updatedAt`),
      confirmedAt: receipt.confirmedAt == null
        ? receipt.confirmedAt
        : asIsoTimestamp(receipt.confirmedAt, `receipts.${receipt.id}.confirmedAt`),
    })),
    categories: parsed.data.categories.map(category => ({
      ...category,
      createdAt: asIsoTimestamp(category.createdAt, `categories.${category.id}.createdAt`),
    })),
    aliases: parsed.data.aliases.map(alias => ({
      ...alias,
      createdAt: asIsoTimestamp(alias.createdAt, `aliases.${alias.id}.createdAt`),
      updatedAt: asIsoTimestamp(alias.updatedAt, `aliases.${alias.id}.updatedAt`),
    })),
    settings: parsed.data.settings ?? null,
  };
}

function payloadForIntegrity(envelope: Omit<BackupEnvelope, 'integrity'>): string {
  return JSON.stringify({
    version: envelope.version,
    timestamp: envelope.timestamp,
    profile: envelope.profile,
    receipts: envelope.receipts,
    categories: envelope.categories,
    aliases: envelope.aliases,
    settings: envelope.settings,
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Convert Firestore-shaped values to the app's JSON-safe data contract. */
export function normalizeBackupContents(input: unknown): BackupContents {
  assertSafeValues(input);
  return parseBackupContents(input);
}

/** Summarize a restore without changing data, using document IDs as conflicts. */
export function summarizeRestoreRecords<T extends { id: string }>(
  incoming: T[],
  existing: T[],
): RestoreRecordCounts {
  const existingById = new Map(existing.map(record => [record.id, record]));
  return incoming.reduce<RestoreRecordCounts>((counts, record) => {
    const current = existingById.get(record.id);
    if (!current) counts.new += 1;
    else if (JSON.stringify(record) === JSON.stringify(current)) counts.unchanged += 1;
    else counts.overwritten += 1;
    return counts;
  }, { new: 0, overwritten: 0, unchanged: 0 });
}

/** Existing receipts are restored through the repository transaction, not setDoc. */
export function receiptRestorePatch(receipt: ReceiptDocument): Partial<ReceiptDocument> {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, revision: _revision, ...changes } = receipt;
  return changes;
}

export async function generateJSONBackup(contents: BackupContents): Promise<string> {
  const canonical = normalizeBackupContents(contents);
  const unsigned: Omit<BackupEnvelope, 'integrity'> = {
    version: BACKUP_VERSION,
    timestamp: new Date().toISOString(),
    profile: canonical.profile,
    receipts: canonical.receipts,
    categories: canonical.categories,
    aliases: canonical.aliases,
    settings: canonical.settings,
  };
  const envelope: BackupEnvelope = {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      digest: await sha256(payloadForIntegrity(unsigned)),
    },
  };
  const json = JSON.stringify(envelope, null, 2);
  if (utf8Length(json) > MAX_BACKUP_BYTES) {
    throw new Error('Backup exceeds the 10 MB maximum size.');
  }
  return json;
}

export async function validateBackup(jsonString: string): Promise<{
  isValid: boolean;
  envelope?: BackupEnvelope;
  error?: string;
}> {
  try {
    if (utf8Length(jsonString) > MAX_BACKUP_BYTES) {
      return { isValid: false, error: 'Backup exceeds the 10 MB maximum size.' };
    }
    const parsedJson: unknown = JSON.parse(jsonString);
    assertSafeValues(parsedJson);
    const parsedEnvelope = BackupEnvelopeSchema.safeParse(normalizeTimestamps(parsedJson));
    if (!parsedEnvelope.success) {
      return { isValid: false, error: formatZodError(parsedEnvelope.error) };
    }

    const { integrity, ...unsigned } = parsedEnvelope.data;
    const canonicalUnsigned: Omit<BackupEnvelope, 'integrity'> = {
      version: BACKUP_VERSION,
      timestamp: unsigned.timestamp,
      profile: unsigned.profile ?? null,
      receipts: unsigned.receipts,
      categories: unsigned.categories,
      aliases: unsigned.aliases,
      settings: unsigned.settings ?? null,
    };
    const expectedDigest = await sha256(payloadForIntegrity(canonicalUnsigned));
    if (integrity.digest !== expectedDigest) {
      return { isValid: false, error: 'Backup integrity check failed. The file may be corrupted or changed.' };
    }

    const contents = normalizeBackupContents({
      profile: canonicalUnsigned.profile,
      receipts: canonicalUnsigned.receipts,
      categories: canonicalUnsigned.categories,
      aliases: canonicalUnsigned.aliases,
      settings: canonicalUnsigned.settings,
    });
    return { isValid: true, envelope: { ...canonicalUnsigned, ...contents, integrity } };
  } catch (error) {
    return { isValid: false, error: error instanceof Error ? error.message : 'Invalid backup file.' };
  }
}
