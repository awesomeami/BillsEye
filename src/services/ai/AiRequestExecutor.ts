import { AiRequestError } from '../../domain/aiTypes';
import { KeyRotationManager } from './KeyRotationManager';
import { CryptoUtils } from './crypto';

interface ExecutionContext {
  signal?: AbortSignal;
}

interface RequestErrorDetails {
  name?: string;
  message?: string;
  status?: number;
  statusCode?: number;
  code?: string;
  retryAfterMs?: number;
}

const requestErrorDetails = (error: unknown): RequestErrorDetails => {
  if (error instanceof Error) {
    const extended = error as Error & Omit<RequestErrorDetails, 'name' | 'message'>;
    return {
      name: extended.name,
      message: extended.message,
      status: extended.status,
      statusCode: extended.statusCode,
      code: extended.code,
      retryAfterMs: extended.retryAfterMs,
    };
  }
  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>;
    return {
      name: typeof candidate.name === 'string' ? candidate.name : undefined,
      message: typeof candidate.message === 'string' ? candidate.message : undefined,
      status: typeof candidate.status === 'number' ? candidate.status : undefined,
      statusCode: typeof candidate.statusCode === 'number' ? candidate.statusCode : undefined,
      code: typeof candidate.code === 'string' ? candidate.code : undefined,
      retryAfterMs: typeof candidate.retryAfterMs === 'number' ? candidate.retryAfterMs : undefined,
    };
  }
  return {};
};

const extractionConfigurationErrorMessage = (code: string | undefined): string | undefined => {
  switch (code) {
    case 'DEPLOYMENT_PROTECTION_BLOCKED':
      return 'Receipt extraction is blocked by Vercel Deployment Protection. The app owner must allow access to the production deployment.';
    case 'CONFIGURATION_UNAVAILABLE':
      return 'Receipt extraction is unavailable because the server Firebase Admin configuration is incomplete. The app owner must configure Firebase Admin for this deployment.';
    default:
      return undefined;
  }
};

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
        // A browser-storage read problem is not evidence that Gemini rejected
        // the key. Never poison the slot as invalid until the API returns an
        // actual authentication failure.
        throw new Error('The saved AI key is not available in this browser. Open Settings and save the key again.');
      }

      attempts++;

      try {
        // Execute the operation
        const result = await operation(key, context?.signal);
        
        // Success!
        this.rotationManager.handleSuccess(keyIndex);
        return result;

      } catch (error) {
        // Redact any raw error messages
        const details = requestErrorDetails(error);
        const configurationError = extractionConfigurationErrorMessage(details.code);
        if (configurationError) {
          // These errors are unrelated to a Gemini key and cannot be fixed by
          // retrying. Preserve the key and let the queue show an actionable,
          // terminal error instead of scheduling an endless retry loop.
          throw Object.assign(new Error(configurationError), {
            status: 424,
            code: details.code,
          });
        }
        const safeMessage = CryptoUtils.redactString(details.message ?? 'Unknown error');
        
        const aiError = this.classifyError(details, safeMessage);

        if (aiError.code === 'cancelled') {
          throw aiError;
        }

        if (aiError.code === 'fatal_auth_error') {
          // Firebase 401 session expired - do NOT penalize the Gemini key or rotate, abort immediately.
          throw new Error(`AI Request Failed: ${aiError.message}`);
        }

        if (aiError.code === 'service_rate_limit') {
          throw Object.assign(
            new Error(aiError.message),
            {
              status: details.status ?? details.statusCode ?? 429,
              code: details.code,
              retryAfterMs: aiError.retryAfterMs,
            },
          );
        }

        if (aiError.code === 'network_error') {
          // A failed app server or connection is not evidence that Gemini
          // rejected this key. Preserve the slot and let the receipt queue
          // retry the service request instead of reporting key cooldown.
          throw Object.assign(
            new Error('Receipt extraction service is temporarily unavailable. Please try again.'),
            {
              status: details.status ?? details.statusCode ?? 503,
              code: details.code,
              retryAfterMs: details.retryAfterMs,
            },
          );
        }

        if (aiError.code === 'bad_request') {
          // Schema rejection, safety block, 400 - DO NOT rotate, abort.
          throw Object.assign(
            new Error(`AI Request Failed: ${aiError.message}`),
            { status: details.status ?? details.statusCode, code: details.code },
          );
        }

        this.rotationManager.handleError(keyIndex, aiError);

        // For auth_failed and rate_limit, loop and try the next key.
        if (attempts >= maxAttempts) {
          throw new Error(`Request failed after ${attempts} attempts. Last error: ${aiError.message}`);
        }
      }
    }

    throw new Error('Execution ended unexpectedly.');
  }

  private classifyError(error: RequestErrorDetails, safeMessage: string): AiRequestError {
    if (error.name === 'AbortError') {
      return { code: 'cancelled', message: 'Cancelled' };
    }
    
    const status = error.status ?? error.statusCode;
    
    if (status === 429 && error.code === 'QUOTA_EXCEEDED') {
      return { code: 'rate_limit', message: 'Rate limit exceeded', retryAfterMs: error.retryAfterMs };
    }
    if (status === 429) {
      return {
        code: 'service_rate_limit',
        message: safeMessage || 'Extraction service is busy. Please try again.',
        retryAfterMs: error.retryAfterMs,
      };
    }
    if (status === 401) {
      return { code: 'fatal_auth_error', message: 'User authentication failed (Firebase 401)' };
    }
    if (status === 403) {
      return { code: 'auth_failed', message: 'Invalid API key or permissions' };
    }
    if (status === 400 || status === 422 || error.message?.toLowerCase().includes('schema')) {
      return { code: 'bad_request', message: safeMessage };
    }
    if ((status !== undefined && status >= 500) || status === 408 || error.message?.toLowerCase().includes('network')) {
      return { code: 'network_error', message: 'Network or server error' };
    }

    return { code: 'unknown', message: safeMessage };
  }
}
