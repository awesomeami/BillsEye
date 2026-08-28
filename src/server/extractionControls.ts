import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * Admin-only collection. Client Firestore rules deny it through the catch-all
 * rule; records contain no tokens, keys, image data, or receipt content.
 */
export const EXTRACTION_CONTROL_COLLECTION = 'serverExtractionControls';

/**
 * A one-minute fixed window limits costly Gemini calls per Firebase UID. The
 * 65-second lease exceeds the 55-second request timeout and Vercel's 60-second
 * function limit, so a terminated invocation releases itself shortly after it
 * can no longer be running.
 */
export type ExtractionControlConfig = {
  maxRequestsPerWindow: number;
  rateWindowMs: number;
  leaseDurationMs: number;
};

export const DEFAULT_EXTRACTION_CONTROL_CONFIG: ExtractionControlConfig = {
  maxRequestsPerWindow: 10,
  rateWindowMs: 60_000,
  leaseDurationMs: 65_000,
};

type ExtractionControlRecord = {
  windowStartedAtMs: number;
  requestCount: number;
  leaseId: string | null;
  leaseExpiresAtMs: number;
};

type StoreUpdate<T> = {
  record: ExtractionControlRecord;
  result: T;
};

export interface AtomicExtractionControlStore {
  run<T>(uid: string, update: (current: ExtractionControlRecord | null) => StoreUpdate<T>): Promise<T>;
}

export type ExtractionAdmission =
  | { allowed: true; leaseId: string }
  | { allowed: false; reason: 'rate_limited' | 'concurrent_request'; retryAfterSeconds: number };

const asFiniteNonNegativeNumber = (value: unknown, fallback = 0): number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
);

const readControlRecord = (data: Record<string, unknown> | undefined): ExtractionControlRecord | null => {
  if (!data) return null;

  return {
    windowStartedAtMs: asFiniteNonNegativeNumber(data.windowStartedAtMs),
    requestCount: Math.floor(asFiniteNonNegativeNumber(data.requestCount)),
    leaseId: typeof data.leaseId === 'string' ? data.leaseId : null,
    leaseExpiresAtMs: asFiniteNonNegativeNumber(data.leaseExpiresAtMs),
  };
};

const controlDocumentId = (uid: string): string => (
  createHash('sha256').update(uid).digest('hex')
);

/** Firestore transactions make admission atomic across Vercel instances. */
export class FirestoreExtractionControlStore implements AtomicExtractionControlStore {
  constructor(private readonly db: Firestore) {}

  async run<T>(uid: string, update: (current: ExtractionControlRecord | null) => StoreUpdate<T>): Promise<T> {
    const document = this.db.collection(EXTRACTION_CONTROL_COLLECTION).doc(controlDocumentId(uid));

    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(document);
      const { record, result } = update(readControlRecord(snapshot.data()));
      transaction.set(document, record);
      return result;
    });
  }
}

/**
 * Used only as an instance-local, low-latency secondary safeguard and in unit
 * tests. It intentionally shares the same atomic interface as Firestore.
 */
export class InMemoryExtractionControlStore implements AtomicExtractionControlStore {
  private readonly records = new Map<string, ExtractionControlRecord>();
  private pending = Promise.resolve();

  async run<T>(uid: string, update: (current: ExtractionControlRecord | null) => StoreUpdate<T>): Promise<T> {
    const operation = this.pending.then(() => {
      const current = this.records.get(uid) ?? null;
      const { record, result } = update(current);
      this.records.set(uid, record);
      return result;
    });

    // Keep the queue usable after a rejected operation.
    this.pending = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

export class ExtractionControlService {
  constructor(
    private readonly store: AtomicExtractionControlStore,
    private readonly config: ExtractionControlConfig = DEFAULT_EXTRACTION_CONTROL_CONFIG,
  ) {}

  async acquire(uid: string, leaseId: string, nowMs = Date.now()): Promise<ExtractionAdmission> {
    return this.store.run<ExtractionAdmission>(uid, (current) => {
      const isCurrentWindow = current !== null
        && current.windowStartedAtMs + this.config.rateWindowMs > nowMs;
      const windowStartedAtMs = isCurrentWindow ? current.windowStartedAtMs : nowMs;
      const requestCount = isCurrentWindow ? current.requestCount : 0;
      const leaseIsActive = current !== null
        && current.leaseId !== null
        && current.leaseExpiresAtMs > nowMs;

      if (requestCount >= this.config.maxRequestsPerWindow) {
        const retryAfterSeconds = Math.max(1, Math.ceil(
          (windowStartedAtMs + this.config.rateWindowMs - nowMs) / 1000,
        ));
        return {
          record: current ?? { windowStartedAtMs, requestCount, leaseId: null, leaseExpiresAtMs: 0 },
          result: { allowed: false, reason: 'rate_limited', retryAfterSeconds },
        };
      }

      if (leaseIsActive) {
        const activeControl = current!;
        return {
          record: activeControl,
          result: {
            allowed: false,
            reason: 'concurrent_request',
            retryAfterSeconds: Math.max(1, Math.ceil((activeControl.leaseExpiresAtMs - nowMs) / 1000)),
          },
        };
      }

      return {
        record: {
          windowStartedAtMs,
          requestCount: requestCount + 1,
          leaseId,
          leaseExpiresAtMs: nowMs + this.config.leaseDurationMs,
        },
        result: { allowed: true, leaseId },
      };
    });
  }

  async release(uid: string, leaseId: string): Promise<void> {
    await this.store.run(uid, (current) => {
      if (!current || current.leaseId !== leaseId) {
        return {
          record: current ?? { windowStartedAtMs: Date.now(), requestCount: 0, leaseId: null, leaseExpiresAtMs: 0 },
          result: undefined,
        };
      }

      return {
        record: { ...current, leaseId: null, leaseExpiresAtMs: 0 },
        result: undefined,
      };
    });
  }
}
