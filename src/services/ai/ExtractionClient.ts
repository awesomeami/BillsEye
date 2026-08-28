import { ExtractionResultSchema, type ExtractionResultDTO } from '../../domain/schema';
import { getAuth } from 'firebase/auth';

const useE2eMocks = import.meta.env.VITE_E2E_MOCKS === 'true';

class ExtractionRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ExtractionRequestError';
  }
}

function getErrorResponse(data: unknown): { message?: string; code?: string } {
  if (typeof data !== 'object' || data === null) return {};
  const record = data as Record<string, unknown>;
  return {
    message: typeof record.error === 'string' ? record.error : undefined,
    code: typeof record.code === 'string' ? record.code : undefined,
  };
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
      let errorMessage = 'Extraction failed';
      let errorData: { message?: string; code?: string } | undefined;
      try {
        errorData = getErrorResponse(await response.json());
        errorMessage = errorData.message || errorMessage;
      } catch {
        // Not JSON
        errorMessage = await response.text();
      }
      
      throw new ExtractionRequestError(errorMessage, response.status, errorData?.code);
    }

    
    const result = await response.json();
    const validatedResult = ExtractionResultSchema.parse(result);
    return validatedResult;

  }
}
