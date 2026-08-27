import { ReceiptDocument, CategoryDocument, AppSettingsDocument } from '../../domain/schema';

export interface BackupEnvelope {
  version: number;
  timestamp: string;
  appSettings?: AppSettingsDocument;
  categories: CategoryDocument[];
  receipts: ReceiptDocument[];
  checksum: string;
}


const MAX_BACKUP_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_STRING_LENGTH = 10000;
const MAX_ARRAY_LENGTH = 5000;

function enforceLimitsAndStripUnknowns(obj: any, schemaFields: string[]): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    if (obj.length > MAX_STRING_LENGTH) throw new Error('String length exceeds limit');
    // Check for base64/data URLs loosely
    if (obj.startsWith('data:image/') || obj.length > 5000 && !obj.includes(' ')) {
      throw new Error('Base64/Image data not allowed in backup');
    }
    return obj;
  }
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    if (obj.length > MAX_ARRAY_LENGTH) throw new Error('Array length exceeds limit');
    return obj.map(item => enforceLimitsAndStripUnknowns(item, []));
  }

  const cleanObj: any = {};
  for (const key of Object.keys(obj)) {
    if (schemaFields.length > 0 && !schemaFields.includes(key)) {
      continue; // Strip unknown field
    }
    // recursive call but we don't know the exact schema of nested objects perfectly here without a deep schema definition.
    // We will just let them pass if they pass the string limits, or we define specific sub-schemas.
    cleanObj[key] = enforceLimitsAndStripUnknowns(obj[key], []);
  }
  return cleanObj;
}

const RECEIPT_FIELDS = [
  'id', 'schemaVersion', 'revision', 'status', 'createdAt', 'updatedAt', 'confirmedAt',
  'sourceFileName', 'sourceMimeType', 'sourceSha256', 'sourcePageNumber',
  'merchantRaw', 'merchantNormalized', 'branchAddress', 'receiptNumber',
  'transactionDate', 'transactionTime', 'dateAmbiguous',
  'currency', 'paymentMethod',
  'items',
  'printedGrandTotal', 'printedSubtotal', 'printedDiscount', 'printedTax', 'printedFees', 'printedRounding',
  'computedLineTotal', 'computedExpectedTotal', 'discrepancy', 'reconciliationStatus',
  'rawOcrText', 'overallConfidence', 'warnings', 'ambiguousFields',
  'extractionModel', 'extractionModelActual', 'extractionSchemaVersion', 'extractionDurationMs',
  'userNote', 'wasEditedByUser'
];
const CATEGORY_FIELDS = ['id', 'name', 'isCustom', 'createdAt', 'updatedAt'];
const SETTINGS_FIELDS = ['id', 'language', 'theme', 'currency', 'timezone', 'createdAt', 'updatedAt'];


function generateChecksum(data: string): string {
  // Simple hash for validation (in production could use crypto, but simple hash is fine for simple backup)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString();
}

export function generateJSONBackup(
  receipts: ReceiptDocument[],
  categories: CategoryDocument[],
  appSettings?: AppSettingsDocument
): string {
  // Strip sensitive fields
  const cleanReceipts = receipts.map(r => enforceLimitsAndStripUnknowns(r, RECEIPT_FIELDS) as ReceiptDocument);

  const envelope: BackupEnvelope = {
    version: 1,
    timestamp: new Date().toISOString(),
    appSettings: appSettings ? enforceLimitsAndStripUnknowns(appSettings, SETTINGS_FIELDS) : undefined,
    categories: categories.map(c => enforceLimitsAndStripUnknowns(c, CATEGORY_FIELDS)),
    receipts: cleanReceipts,
    checksum: ''
  };

  const payloadString = JSON.stringify({
    version: envelope.version,
    categories: envelope.categories,
    receipts: envelope.receipts
  });

  envelope.checksum = generateChecksum(payloadString);

  return JSON.stringify(envelope, null, 2);
}

export function validateBackup(jsonString: string): { isValid: boolean; envelope?: BackupEnvelope; error?: string } {
  try {
    const parsed = JSON.parse(jsonString) as BackupEnvelope;
    
    if (jsonString.length > MAX_BACKUP_BYTES) return { isValid: false, error: 'Backup exceeds maximum allowed size (10MB)' };

    if (!parsed.version || !parsed.receipts || !parsed.categories) {
      return { isValid: false, error: 'Invalid backup format: Missing required fields.' };
    }

    const payloadString = JSON.stringify({
      version: parsed.version,
      categories: parsed.categories,
      receipts: parsed.receipts
    });

    const expectedChecksum = generateChecksum(payloadString);
    if (parsed.checksum !== expectedChecksum) {
      return { isValid: false, error: 'Checksum mismatch. The file may be corrupted.' };
    }

    return { isValid: true, envelope: parsed };
  } catch (e: any) {
    return { isValid: false, error: e.message };
  }
}
