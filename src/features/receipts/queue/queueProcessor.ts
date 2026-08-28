import { QueueItem, QueueAction } from './queueReducer';
import { ReceiptDocument, ReceiptSchema } from '../../../domain/schema';

export type QueueProcessingOutcome = 'continue' | 'pause' | 'stopped';

export type QueueExtractionResult = Partial<ReceiptDocument> & {
  isReceipt: boolean;
  documentWarnings?: string[];
};

export interface QueueAttemptServices {
  isOnline: () => boolean;
  preprocessImage: (file: Blob, signal?: AbortSignal, maxSizeBytes?: number) => Promise<{ blob: Blob; mimeType: string }>;
  createSha256Hash: (blob: Blob) => Promise<string>;
  findByHash: (userId: string, sha256: string) => Promise<Array<{ id: string }>>;
  extractReceipt: (key: string, file: File, signal: AbortSignal) => Promise<QueueExtractionResult>;
  createReceipt: (userId: string, receipt: ReceiptDocument) => Promise<unknown>;
  storeImage: (userId: string, receiptId: string, image: Blob) => void;
  renderPdfPage: (file: File, pageNumber: number) => Promise<Blob>;
  createReceiptId: () => string;
  now: () => string;
}

export interface QueueExecutor {
  execute<T>(
    operationName: string,
    operation: (key: string, signal?: AbortSignal) => Promise<T>,
    getDecryptedKey: (index: number) => Promise<string | null>,
  ): Promise<T>;
}

export interface QueueRotationManager {
  getEarliestRetryTime(): number | null;
}

export interface RetryTimer {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

/** Schedules the earliest retry wake-up and is explicitly disposable on unmount. */
export class QueueRetryScheduler {
  private handle: ReturnType<typeof setTimeout> | null = null;
  private scheduledFor: number | null = null;

  constructor(
    private readonly onRetryDue: () => void,
    private readonly timers: RetryTimer = { setTimeout, clearTimeout },
  ) {}

  schedule(items: QueueItem[], now = Date.now()) {
    const nextRetry = items.reduce<number | null>((earliest, item) => {
      if (item.status !== 'retry-wait' || item.retryAfter === undefined) return earliest;
      return earliest === null ? item.retryAfter : Math.min(earliest, item.retryAfter);
    }, null);

    if (nextRetry === this.scheduledFor && this.handle !== null) return;
    this.cancel();
    if (nextRetry === null) return;

    this.scheduledFor = nextRetry;
    this.handle = this.timers.setTimeout(() => {
      this.handle = null;
      this.scheduledFor = null;
      this.onRetryDue();
    }, Math.max(0, nextRetry - now));
  }

  cancel() {
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
    this.scheduledFor = null;
  }
}

export interface ProcessQueueAttemptOptions {
  item: QueueItem;
  userId: string;
  dispatch: React.Dispatch<QueueAction>;
  executor: QueueExecutor;
  getDecryptedKey: (index: number) => Promise<string | null>;
  rotationManager: QueueRotationManager | null;
  isSessionActive: () => boolean;
  services: QueueAttemptServices;
}

const abortError = () => new DOMException('Aborted', 'AbortError');

function ensureAttemptIsActive(signal: AbortSignal, isSessionActive: () => boolean) {
  if (signal.aborted || !isSessionActive()) throw abortError();
}

function errorDetails(error: unknown) {
  const value = error as { name?: string; message?: string; status?: number };
  return {
    name: value?.name,
    message: value?.message || 'Receipt processing failed.',
    status: value?.status
  };
}

/** Processes exactly one claimed item; React state never controls this loop. */
export async function processQueueAttempt({
  item,
  userId,
  dispatch,
  executor,
  getDecryptedKey,
  rotationManager,
  isSessionActive,
  services
}: ProcessQueueAttemptOptions): Promise<QueueProcessingOutcome> {
  const { id, abortController } = item;

  try {
    ensureAttemptIsActive(abortController.signal, isSessionActive);

    if (!services.isOnline()) {
      dispatch({
        type: 'UPDATE_ITEM',
        id,
        updates: { status: 'failed-permanent', error: 'Internet is required to process a receipt.' }
      });
      return 'pause';
    }

    let fileToProcess = item.file;
    let mimeType = item.mimeType;
    if (item.sourcePdf && item.pageNumber !== undefined) {
      const renderedBlob = await services.renderPdfPage(item.sourcePdf, item.pageNumber);
      ensureAttemptIsActive(abortController.signal, isSessionActive);
      fileToProcess = renderedBlob;
      mimeType = 'image/jpeg';
      // Avoid allocating a PDF preview URL that could race an auth cleanup.
      dispatch({ type: 'UPDATE_ITEM', id, updates: { file: renderedBlob, mimeType } });
    }

    const { blob: processedBlob, mimeType: processedMime } = await services.preprocessImage(
      fileToProcess,
      abortController.signal
    );
    ensureAttemptIsActive(abortController.signal, isSessionActive);

    dispatch({
      type: 'UPDATE_ITEM',
      id,
      updates: { status: 'duplicate-check', file: processedBlob, mimeType: processedMime }
    });
    const sha256 = await services.createSha256Hash(processedBlob);
    ensureAttemptIsActive(abortController.signal, isSessionActive);

    dispatch({ type: 'UPDATE_ITEM', id, updates: { sha256 } });
    const existing = await services.findByHash(userId, sha256);
    ensureAttemptIsActive(abortController.signal, isSessionActive);
    if (existing.length > 0) {
      dispatch({ type: 'UPDATE_ITEM', id, updates: { status: 'duplicate', receiptId: existing[0].id } });
      return 'continue';
    }

    dispatch({ type: 'UPDATE_ITEM', id, updates: { status: 'extracting' } });
    const result = await executor.execute<QueueExtractionResult>(
      'ExtractReceipt',
      async (key: string, signal?: AbortSignal) => {
        const compositeSignal = signal
          ? anySignal([signal, abortController.signal])
          : abortController.signal;
        const fileToUpload = new File([processedBlob], item.originalName, { type: processedMime });
        return services.extractReceipt(key, fileToUpload, compositeSignal);
      },
      getDecryptedKey
    );
    ensureAttemptIsActive(abortController.signal, isSessionActive);

    if (!result.isReceipt) {
      dispatch({
        type: 'UPDATE_ITEM',
        id,
        updates: {
          status: 'failed-permanent',
          error: result.documentWarnings?.join(', ') || 'Image does not appear to be a receipt.'
        }
      });
      return 'continue';
    }

    const newReceiptId = services.createReceiptId();
    const { isReceipt: _isReceipt, documentWarnings: _documentWarnings, ...extractedReceipt } = result;
    const now = services.now();
    const receiptDoc = ReceiptSchema.parse({
      ...extractedReceipt,
      id: newReceiptId,
      schemaVersion: 2,
      revision: 1,
      status: 'pendingReview',
      createdAt: now,
      updatedAt: now,
      confirmedAt: null,
      sourceFileName: item.originalName,
      sourceMimeType: processedMime,
      sourceSha256: sha256,
      sourcePageNumber: item.pageNumber ?? null,
      wasEditedByUser: false,
    });

    ensureAttemptIsActive(abortController.signal, isSessionActive);
    await services.createReceipt(userId, receiptDoc);
    ensureAttemptIsActive(abortController.signal, isSessionActive);
    services.storeImage(userId, newReceiptId, processedBlob);
    dispatch({
      type: 'UPDATE_ITEM',
      id,
      updates: { status: 'needs-review', extractionResult: result, receiptId: newReceiptId }
    });
    return 'continue';
  } catch (error: unknown) {
    if (!isSessionActive()) return 'stopped';
    const { name, message, status } = errorDetails(error);
    if (name === 'AbortError') {
      if (isSessionActive()) dispatch({ type: 'CANCEL_ITEM', id });
      return 'stopped';
    }

    const isRateLimit = message.includes('cooldown') || status === 429;
    const is5xx = typeof status === 'number' && status >= 500 && status < 600;
    const isNetwork = message.toLowerCase().includes('fetch') || message.toLowerCase().includes('network');
    if (isRateLimit || is5xx || isNetwork) {
      dispatch({
        type: 'UPDATE_ITEM',
        id,
        updates: {
          status: 'retry-wait',
          error: message,
          retryAfter: rotationManager?.getEarliestRetryTime() || Date.now() + 30000
        }
      });
      return 'pause';
    }

    dispatch({ type: 'UPDATE_ITEM', id, updates: { status: 'failed-permanent', error: message } });
    return 'continue';
  }
}

interface SequentialQueueRunnerOptions {
  getNextItem: () => QueueItem | undefined;
  claimItem: (item: QueueItem) => void;
  processItem: (item: QueueItem) => Promise<QueueProcessingOutcome>;
  canContinue: () => boolean;
  requestNext: () => void;
}

/** A single-flight scheduler that never claims the same queued item twice. */
export class SequentialQueueRunner {
  private processingItemId: string | null = null;

  constructor(private readonly options: SequentialQueueRunnerOptions) {}

  get isProcessing() {
    return this.processingItemId !== null;
  }

  wake() {
    if (this.processingItemId) return false;
    const item = this.options.getNextItem();
    if (!item) return false;

    this.processingItemId = item.id;
    this.options.claimItem(item);
    void this.run(item);
    return true;
  }

  private async run(item: QueueItem) {
    try {
      await this.options.processItem(item);
    } finally {
      this.processingItemId = null;
      // A delayed, cancelled, or failed item must never starve a later item
      // that is already eligible. Session teardown leaves no eligible item.
      if (this.options.canContinue()) {
        this.options.requestNext();
      }
    }
  }
}

function anySignal(signals: AbortSignal[]) {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
