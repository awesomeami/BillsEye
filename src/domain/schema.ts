import { z } from 'zod';

export const ReceiptItemSchema = z.object({
  id: z.string(),
  rawLineText: z.string().optional(),
  name: z.string().optional(), // raw/normalized name
  brand: z.string().optional(),
  quantity: z.number().nullable().optional(),
  unit: z.string().optional(),
  unitPrice: z.number().nullable().optional(), // In minor units (e.g. cents, paisa)
  discount: z.number().nullable().optional(), // In minor units
  lineTotal: z.number().nullable().optional(), // In minor units
  category: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  userEdited: z.boolean().default(false),
  warnings: z.array(z.string()).optional()
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
  sourceFileName: z.string().optional(),
  sourceMimeType: z.string().optional(),
  sourceSha256: z.string().optional(),
  sourcePageNumber: z.number().optional(),

  // Merchant Information
  merchantRaw: z.string().optional(),
  merchantNormalized: z.string().optional(),
  branchAddress: z.string().optional(),
  receiptNumber: z.string().optional(),

  // Date and Time (strictly YYYY-MM-DD for date)
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  transactionTime: z.string().nullable().optional(),
  dateAmbiguous: z.boolean().default(false), // True if DD/MM vs MM/DD is unclear

  // Currency & Payment
  currency: z.string().default('PKR'),
  paymentMethod: z.string().optional(),

  // Items
  items: z.array(ReceiptItemSchema).default([]),

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
  rawOcrText: z.string().optional(), // preserving meaningful line order
  overallConfidence: z.number().min(0).max(1).optional(),
  warnings: z.array(z.string()).default([]),
  ambiguousFields: z.array(z.string()).default([]),
  extractionModel: z.string().optional(),
  extractionModelActual: z.string().optional(),
  extractionSchemaVersion: z.string().optional(),
  extractionDurationMs: z.number().optional(),

  // User input
  userNote: z.string().max(500).optional(),
  wasEditedByUser: z.boolean().default(false),
});

export type ReceiptDocument = z.infer<typeof ReceiptSchema>;

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
  isCustom: z.boolean().default(false),
  createdAt: z.string(),
  color: z.string().optional(),
  icon: z.string().optional(),
  order: z.number().default(0),
  isActive: z.boolean().default(true),
});

export type CategoryDocument = z.infer<typeof CategorySchema>;

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

export const ExtractionResultItemSchema = z.object({
  rawLineText: z.string(),
  name: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  quantity: z.number().optional().nullable(),
  unit: z.string().optional().nullable(),
  unitPrice: z.number().optional().nullable(),
  discount: z.number().optional().nullable(),
  lineTotal: z.number().optional().nullable(),
  categorySuggestion: z.string().optional().nullable(),
  confidence: z.number(),
  warnings: z.array(z.string()).default([])
});

export const ExtractionResultSchema = z.object({
  isReceipt: z.boolean(),
  documentWarnings: z.array(z.string()).optional().default([]),
  merchantRaw: z.string().optional().nullable(),
  merchantNormalizedSuggestion: z.string().optional().nullable(),
  branchAddress: z.string().optional().nullable(),
  receiptNumber: z.string().optional().nullable(),
  transactionDateCandidate: z.string().optional().nullable(),
  transactionTimeCandidate: z.string().optional().nullable(),
  dateInterpretationNote: z.string().optional().nullable(),
  currency: z.string().optional().nullable(),
  paymentMethodCandidate: z.string().optional().nullable(),
  items: z.array(ExtractionResultItemSchema).optional().default([]),
  printedSubtotal: z.number().optional().nullable(),
  printedDiscount: z.number().optional().nullable(),
  printedTax: z.number().optional().nullable(),
  printedFees: z.number().optional().nullable(),
  printedRounding: z.number().optional().nullable(),
  printedGrandTotal: z.number().optional().nullable(),
  rawOcrText: z.string().optional().default(''),
  overallConfidence: z.number().optional().default(1),
  ambiguousFields: z.array(z.string()).optional().default([]),
  extractionSchemaVersion: z.union([z.string(), z.number()]).optional(),
  extractionModel: z.string().optional(),
  extractionModelActual: z.string().optional(),
  extractionDurationMs: z.number().optional(),
  computedLineTotal: z.number().optional().nullable(),
  computedExpectedTotal: z.number().optional().nullable(),
  discrepancy: z.number().optional().nullable(),
  reconciliationStatus: z.enum(['matched', 'mismatched', 'unknown']).optional(),
  warnings: z.array(z.string()).optional().default([])
});

export type ExtractionResultDTO = z.infer<typeof ExtractionResultSchema>;
