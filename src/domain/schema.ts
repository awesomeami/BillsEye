import { z } from 'zod';

// Receipt items are stored in a Firestore subcollection, so Rules validate one
// item document per write instead of unrolling list validation in its parent.
export const MAX_RECEIPT_ITEMS = 40;

export const ReceiptItemSchema = z.object({
  id: z.string().min(1).max(128),
  rawLineText: z.string().max(500).optional(),
  name: z.string().max(200).nullable().optional(), // raw/normalized name
  brand: z.string().max(100).nullable().optional(),
  quantity: z.number().min(0).nullable().optional(),
  unit: z.string().max(50).nullable().optional(),
  unitPrice: z.number().min(0).nullable().optional(), // In minor units (e.g. cents, paisa)
  discount: z.number().min(0).nullable().optional(), // In minor units
  lineTotal: z.number().min(0).nullable().optional(), // In minor units
  // Stable category identity for all new writes. `category` is retained only
  // as a readable compatibility field for historical receipts.
  categoryId: z.string().min(1).max(128).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  userEdited: z.boolean().default(false),
  warnings: z.array(z.string().max(200)).max(10).optional()
});

export const ReceiptSchema = z.object({
  id: z.string(),
  schemaVersion: z.number().default(2),
  revision: z.number().default(1),
  status: z.enum(['pendingReview', 'confirmed']).default('pendingReview'),
  
  // Timestamps
  createdAt: z.string(), // ISO string or ServerTimestamp sentinel during write
  updatedAt: z.string(),
  confirmedAt: z.string().nullable().optional(),

  // Source Metadata (strictly text, no binary/image data allowed)
  sourceFileName: z.string().max(255).nullable().optional(),
  sourceMimeType: z.string().max(100).nullable().optional(),
  sourceSha256: z.string().max(64).nullable().optional(),
  sourcePageNumber: z.number().min(1).nullable().optional(),

  // Merchant Information
  merchantRaw: z.string().max(255).nullable().optional(),
  merchantNormalized: z.string().max(255).nullable().optional(),
  branchAddress: z.string().max(500).nullable().optional(),
  receiptNumber: z.string().max(100).nullable().optional(),

  // Date and Time (strictly YYYY-MM-DD for date)
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  transactionTime: z.string().max(20).nullable().optional(),
  dateAmbiguous: z.boolean().default(false), // True if DD/MM vs MM/DD is unclear

  // Currency & Payment
  currency: z.string().max(10).default('PKR'),
  paymentMethod: z.string().max(50).nullable().optional(),

  // Items
  items: z.array(ReceiptItemSchema).max(MAX_RECEIPT_ITEMS).default([]),

  // Printed totals (from the receipt itself) - all in minor units
  printedSubtotal: z.number().nullable().optional(),
  printedDiscount: z.number().nullable().optional(),
  printedTax: z.number().nullable().optional(),
  printedFees: z.number().nullable().optional(),
  printedRounding: z.number().nullable().optional(),
  printedGrandTotal: z.number().nullable().optional(),

  // Computed totals & reconciliation
  computedLineTotal: z.number().nullable().optional(),
  computedExpectedTotal: z.number().nullable().optional(),
  discrepancy: z.number().nullable().optional(),
  reconciliationStatus: z.enum(['matched', 'mismatched', 'unknown']).default('unknown'),

  // AI Extraction Metadata
  rawOcrText: z.string().max(100000).optional(), // preserving meaningful line order
  overallConfidence: z.number().min(0).max(1).optional(),
  warnings: z.array(z.string().max(255)).max(20).default([]),
  ambiguousFields: z.array(z.string().max(100)).max(20).default([]),
  extractionModel: z.string().max(100).nullable().optional(),
  extractionModelActual: z.string().max(100).nullable().optional(),
  extractionSchemaVersion: z.string().max(50).nullable().optional(),
  extractionDurationMs: z.number().min(0).nullable().optional(),

  // User input
  userNote: z.string().max(500).nullable().optional(),
  wasEditedByUser: z.boolean().default(false),
});

export type ReceiptDocument = z.infer<typeof ReceiptSchema>;

// Reads remain permissive enough for historical documents that omitted
// optional fields. Every new or updated Firestore document is validated with
// this strict variant so unknown fields cannot be persisted by the app.
export const ReceiptWriteSchema = ReceiptSchema.extend({
  items: z.array(ReceiptItemSchema.strict()).max(MAX_RECEIPT_ITEMS).default([]),
}).strict();

// Firestore stores receipt items in users/{uid}/receipts/{receiptId}/items.
// The parent keeps an empty compatibility list; this is validated separately
// from the in-memory ReceiptDocument that the application displays and edits.
export const StoredReceiptWriteSchema = ReceiptWriteSchema.extend({
  itemStorageVersion: z.literal(2),
  items: z.array(z.never()).length(0),
}).strict();

export const UserProfileSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  createdAt: z.string(),
  lastLoginAt: z.string(),
  schemaVersion: z.number().default(1),
});

export type UserProfileDocument = z.infer<typeof UserProfileSchema>;

export const AppSettingsSchema = z.object({
  currency: z.string().default('PKR'),
  locale: z.string().default('en-PK'),
  timeZone: z.string().default('Asia/Karachi'),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  lowConfidenceThreshold: z.number().min(0).max(1).default(0.7),
  discrepancyTolerance: z.number().default(0), // in minor units
});

export type AppSettingsDocument = z.infer<typeof AppSettingsSchema>;

export const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  // Earlier names keep legacy receipt line items resolvable after a rename.
  legacyNames: z.array(z.string().min(1).max(100)).max(20).optional(),
  isCustom: z.boolean().default(false),
  createdAt: z.string(),
  color: z.string().optional(),
  icon: z.string().optional(),
  order: z.number().default(0),
  isActive: z.boolean().default(true),
});

export type CategoryDocument = z.infer<typeof CategorySchema>;

export const AliasSchema = z.object({
  id: z.string().min(1).max(128),
  merchantNormalized: z.string().min(1).max(255),
  categoryId: z.string().min(1).max(128),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AliasDocument = z.infer<typeof AliasSchema>;

export const RawGeminiItemV2 = z.object({
  rawLineText: z.string().default(''),
  name: z.string().nullable().default(null),
  brand: z.string().nullable().default(null),
  quantity: z.number().nullable().default(null),
  unit: z.string().nullable().default(null),
  unitPrice: z.string().nullable().default(null), // Decimal string
  discount: z.string().nullable().default(null), // Decimal string
  lineTotal: z.string().nullable().default(null), // Decimal string
  categorySuggestion: z.enum(['Groceries', 'Meat', 'Fruit & Vegetables', 'Household', 'Medicine', 'Eating Out', 'Miscellaneous']).nullable().default(null),
  confidence: z.number().min(0).max(1).default(1),
  warnings: z.array(z.string()).default([])
});

export const RawGeminiReceiptV2 = z.object({
  isReceipt: z.boolean().default(true),
  documentWarnings: z.array(z.string()).default([]),
  merchantRaw: z.string().nullable().default(null),
  merchantNormalizedSuggestion: z.string().nullable().default(null),
  branchAddress: z.string().nullable().default(null),
  receiptNumber: z.string().nullable().default(null),
  transactionDateCandidate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  transactionTimeCandidate: z.string().nullable().default(null),
  dateInterpretationNote: z.string().nullable().default(null),
  currency: z.enum(['PKR', 'USD']).nullable().default(null),
  paymentMethodCandidate: z.string().nullable().default(null),
  items: z.array(RawGeminiItemV2).default([]),
  printedSubtotal: z.string().nullable().default(null),
  printedDiscount: z.string().nullable().default(null),
  printedTax: z.string().nullable().default(null),
  printedFees: z.string().nullable().default(null),
  printedRounding: z.string().nullable().default(null),
  printedGrandTotal: z.string().nullable().default(null),
  rawOcrText: z.string().default(''),
  overallConfidence: z.number().min(0).max(1).default(1),
  ambiguousFields: z.array(z.string()).default([])
});

// The extraction DTO uses the same item representation that is persisted.
// The raw Gemini schema above remains separate because Gemini returns decimal
// strings and suggestion field names that must be normalized first.
export const ExtractionResultItemSchema = ReceiptItemSchema;

export const ExtractionResultSchema = z.object({
  isReceipt: z.boolean(),
  documentWarnings: z.array(z.string()).optional().default([]),
  merchantRaw: z.string().max(255).optional().nullable(),
  merchantNormalized: z.string().max(255).optional().nullable(),
  branchAddress: z.string().max(500).optional().nullable(),
  receiptNumber: z.string().max(100).optional().nullable(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  transactionTime: z.string().max(20).optional().nullable(),
  dateAmbiguous: z.boolean().optional().default(false),
  currency: z.string().max(10).optional().default('PKR'),
  paymentMethod: z.string().max(50).optional().nullable(),
  items: z.array(ExtractionResultItemSchema).max(MAX_RECEIPT_ITEMS).optional().default([]),
  printedSubtotal: z.number().min(0).optional().nullable(),
  printedDiscount: z.number().min(0).optional().nullable(),
  printedTax: z.number().min(0).optional().nullable(),
  printedFees: z.number().min(0).optional().nullable(),
  printedRounding: z.number().optional().nullable(),
  printedGrandTotal: z.number().min(0).optional().nullable(),
  rawOcrText: z.string().optional().default(''),
  overallConfidence: z.number().optional().default(1),
  ambiguousFields: z.array(z.string()).optional().default([]),
  extractionSchemaVersion: z.string().max(50).optional().nullable(),
  extractionModel: z.string().max(100).optional().nullable(),
  extractionModelActual: z.string().max(100).optional().nullable(),
  extractionDurationMs: z.number().min(0).optional().nullable(),
  computedLineTotal: z.number().min(0).optional().nullable(),
  computedExpectedTotal: z.number().min(0).optional().nullable(),
  discrepancy: z.number().optional().nullable(),
  reconciliationStatus: z.enum(['matched', 'mismatched', 'unknown']).optional(),
  warnings: z.array(z.string().max(255)).max(20).optional().default([])
});

export type ExtractionResultDTO = z.infer<typeof ExtractionResultSchema>;
