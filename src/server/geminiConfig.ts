export const EXTRACTION_SCHEMA_VERSION = '2';
export const RECEIPT_EXTRACTION_MODEL = 'gemini-3.5-flash-lite';

/**
 * Receipt extraction uses one server-owned stable model ID. The browser and
 * deployment environment cannot override it per request.
 */
export function getReceiptExtractionModel(): string {
  return RECEIPT_EXTRACTION_MODEL;
}
