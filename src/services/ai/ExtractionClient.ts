import { ExtractionResultSchema, type ExtractionResultDTO } from '../../domain/schema';
import { getAuth } from 'firebase/auth';
import { isE2eMockMode } from '../../config/e2eMocks';
import { readExtractionErrorResponse } from './extractionErrors';

const useE2eMocks = isE2eMockMode;

export class ExtractionRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ExtractionRequestError';
  }
}

export class ExtractionClient {
  static async extractReceipt(
    geminiKey: string,
    imageFile: File,
    signal?: AbortSignal
  ): Promise<ExtractionResultDTO> {
    let token = 'e2e-test-firebase-token';
    if (!useE2eMocks) {
      const auth = getAuth();
      if (!auth.currentUser) throw new Error('User is not authenticated');
      token = await auth.currentUser.getIdToken();
    }
    
    // Validate MIME (already done by preprocessor, but good for safety)
    const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED_MIMES.includes(imageFile.type)) {
      throw new Error('Unsupported image format. Use JPEG, PNG, or WebP.');
    }

    const formData = new FormData();
    formData.append('receiptImage', imageFile, imageFile.name);
    formData.append('geminiKey', geminiKey);

    const response = await fetch('/api/extract', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
      signal,
    });

    if (!response.ok) {
      const errorData = await readExtractionErrorResponse(response);
      throw new ExtractionRequestError(
        errorData.message,
        response.status,
        errorData.code,
        errorData.retryAfterMs,
      );
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new ExtractionRequestError(
        'Extraction service returned a malformed success response.',
        502,
        'INVALID_SERVER_RESPONSE',
      );
    }
    const validatedResult = ExtractionResultSchema.safeParse(result);
    if (!validatedResult.success) {
      throw new ExtractionRequestError(
        'Extraction service returned a malformed success response.',
        502,
        'INVALID_SERVER_RESPONSE',
      );
    }
    return validatedResult.data;

  }
}
