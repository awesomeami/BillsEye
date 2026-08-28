export const EXTRACTION_SCHEMA_VERSION = '2';

type GeminiModelEnvironment = Record<string, string | undefined>;

type GeminiModelOptions = {
  mode: string;
};

/**
 * Models are server-only and intentionally have no VITE_ equivalent. A moving
 * alias is rejected so model behavior cannot change without configuration.
 */
export function getReceiptExtractionModel(
  environment: GeminiModelEnvironment = process.env,
  { mode }: GeminiModelOptions = { mode: process.env.NODE_ENV ?? 'development' },
): string {
  const model = environment.GEMINI_EXTRACTION_MODEL?.trim();
  if (!model) {
    throw new Error(`Server configuration is missing required field: GEMINI_EXTRACTION_MODEL for ${mode} mode.`);
  }
  if (!/^gemini-[a-z0-9][a-z0-9.-]{0,127}$/i.test(model) || /(?:^|-)latest$/i.test(model)) {
    throw new Error('Server configuration has an invalid GEMINI_EXTRACTION_MODEL.');
  }
  return model;
}
