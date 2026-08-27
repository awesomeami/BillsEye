import { ExtractionResultSchema, type ExtractionResultDTO } from '../../domain/schema';
import { getAuth } from 'firebase/auth';

export class ExtractionClient {
  static async extractReceipt(
    geminiKey: string,
    imageFile: File,
    signal?: AbortSignal
  ): Promise<ExtractionResultDTO> {
    const auth = getAuth();
    if (!auth.currentUser) {
      throw new Error('User is not authenticated');
    }

    const token = await auth.currentUser.getIdToken();
    
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
      let errorData;
      try {
        errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        // Not JSON
        errorMessage = await response.text();
      }
      
      const error: any = new Error(errorMessage);
      error.status = response.status;
      error.code = errorData?.code;
      throw error;
    }

    
    const result = await response.json();
    const validatedResult = ExtractionResultSchema.parse(result);
    return validatedResult;

  }
}
