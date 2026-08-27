import { AiRequestError } from '../../domain/aiTypes';
import { KeyRotationManager } from './KeyRotationManager';
import { CryptoUtils } from './crypto';

interface ExecutionContext {
  signal?: AbortSignal;
}

export class AiRequestExecutor {
  private rotationManager: KeyRotationManager;

  constructor(rotationManager: KeyRotationManager) {
    this.rotationManager = rotationManager;
  }

  // Simulated request function, later replaced by real API call
  async execute<T>(
    operationName: string,
    operation: (key: string, signal?: AbortSignal) => Promise<T>,
    getDecryptedKey: (index: number) => Promise<string | null>,
    context?: ExecutionContext
  ): Promise<T> {
    const maxAttempts = this.rotationManager.getEligibleCount() + 1; // Limit bounded by available keys + 1 schema repair
    let attempts = 0;

    while (attempts < maxAttempts) {
      if (context?.signal?.aborted) {
        throw { code: 'cancelled', message: 'Request cancelled' } as AiRequestError;
      }

      const keyIndex = this.rotationManager.getEligibleKeyIndex();
      
      if (keyIndex === -1) {
        throw new Error('No valid or enabled AI keys available. Please add a valid key in Settings.');
      }

      if (keyIndex === -2) {
        const retryTime = this.rotationManager.getEarliestRetryTime();
        const waitMs = retryTime ? retryTime - Date.now() : 30000;
        throw new Error(`All keys are on cooldown. Please wait ${Math.ceil(waitMs / 1000)} seconds.`);
      }

      const key = await getDecryptedKey(keyIndex);
      if (!key) {
        // Edge case: key couldn't be decrypted, mark it invalid
        this.rotationManager.handleError(keyIndex, { code: 'auth_failed', message: 'Key decryption failed' });
        continue;
      }

      attempts++;

      try {
        // Execute the operation
        const result = await operation(key, context?.signal);
        
        // Success!
        this.rotationManager.handleSuccess(keyIndex);
        return result;

      } catch (err: any) {
        // Redact any raw error messages
        const safeMessage = CryptoUtils.redactString(err.message || 'Unknown error');
        
        const aiError = this.classifyError(err, safeMessage);

        if (aiError.code === 'fatal_auth_error') {
          // Firebase 401 session expired - do NOT penalize the Gemini key or rotate, abort immediately.
          throw new Error(`AI Request Failed: ${aiError.message}`);
        }

        this.rotationManager.handleError(keyIndex, aiError);

        if (aiError.code === 'cancelled') {
          throw aiError;
        }

        if (aiError.code === 'bad_request') {
          // Schema rejection, safety block, 400 - DO NOT rotate, abort.
          throw new Error(`AI Request Failed: ${aiError.message}`);
        }

        // For auth_failed, rate_limit, network_error, we loop and try the next key
        if (attempts >= maxAttempts) {
          throw new Error(`Request failed after ${attempts} attempts. Last error: ${aiError.message}`);
        }
      }
    }

    throw new Error('Execution ended unexpectedly.');
  }

  private classifyError(err: any, safeMessage: string): AiRequestError {
    if (err.name === 'AbortError') {
      return { code: 'cancelled', message: 'Cancelled' };
    }
    
    const status = err.status || err.statusCode;
    
    if (status === 429) {
      return { code: 'rate_limit', message: 'Rate limit exceeded', retryAfterMs: err.retryAfterMs };
    }
    if (status === 401) {
      return { code: 'fatal_auth_error', message: 'User authentication failed (Firebase 401)' };
    }
    if (status === 403) {
      return { code: 'auth_failed', message: 'Invalid API key or permissions' };
    }
    if (status === 400 || err.message?.toLowerCase().includes('schema')) {
      return { code: 'bad_request', message: safeMessage };
    }
    if (status >= 500 || status === 408 || err.message?.toLowerCase().includes('network')) {
      return { code: 'network_error', message: 'Network or server error' };
    }

    return { code: 'unknown', message: safeMessage };
  }
}
