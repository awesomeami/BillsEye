import { describe, test } from 'node:test';
import assert from 'node:assert';
import { QueueAction, QueueItem, queueReducer } from '../queueReducer';
import {
  processQueueAttempt,
  QueueAttemptServices,
  QueueExecutor,
  QueueProcessingOutcome,
  QueueRetryScheduler,
  SequentialQueueRunner
} from '../queueProcessor';
import { ReceiptDocument } from '../../../../domain/schema';

function createItem(id: string): QueueItem {
  return {
    id,
    file: new Blob(['receipt'], { type: 'image/jpeg' }),
    originalName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    status: 'queued',
    abortController: new AbortController(),
    attempts: []
  };
}

function createServices(overrides: Partial<QueueAttemptServices> = {}): QueueAttemptServices {
  return {
    isOnline: () => true,
    preprocessImage: async () => ({ blob: new Blob(['processed'], { type: 'image/jpeg' }), mimeType: 'image/jpeg' }),
    createSha256Hash: async () => 'receipt-hash',
    findByHash: async () => [],
    extractReceipt: async () => ({ isReceipt: true, items: [] }),
    createReceipt: async () => undefined,
    storeImage: () => undefined,
    renderPdfPage: async () => new Blob(['rendered'], { type: 'image/jpeg' }),
    createReceiptId: () => 'new-receipt',
    now: () => '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function extractingExecutor(): QueueExecutor {
  return {
    execute: async <T>(
      _operation: string,
      execute: (key: string, signal?: AbortSignal) => Promise<T>,
      _getDecryptedKey: (index: number) => Promise<string | null>,
    ) => execute('test-key')
  };
}

function createHarness(item: QueueItem) {
  let state = [item];
  const dispatch = (action: QueueAction) => {
    state = queueReducer(state, action);
  };
  const claim = () => dispatch({ type: 'START_ATTEMPT', id: item.id, timestamp: 1 });
  return { get state() { return state; }, dispatch, claim };
}

async function processClaimedItem(
  item: QueueItem,
  dispatch: (action: QueueAction) => void,
  services: QueueAttemptServices,
  isSessionActive = () => true
) {
  return processQueueAttempt({
    item,
    userId: 'user-a',
    dispatch,
    executor: extractingExecutor(),
    getDecryptedKey: async () => 'test-key',
    rotationManager: { getEarliestRetryTime: () => 123 },
    isSessionActive,
    services
  });
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('receipt queue processor', () => {
  test('processes one queued item once and creates a review receipt', async () => {
    const item = createItem('one');
    const harness = createHarness(item);
    let created = 0;
    let stored = 0;
    harness.claim();

    const outcome = await processClaimedItem(item, harness.dispatch, createServices({
      createReceipt: async () => { created += 1; },
      storeImage: () => { stored += 1; }
    }));

    assert.strictEqual(outcome, 'continue');
    assert.strictEqual(created, 1);
    assert.strictEqual(stored, 1);
    assert.strictEqual(harness.state[0].status, 'needs-review');
    assert.strictEqual(harness.state[0].attempts.length, 1);
  });

  test('preserves the original PDF page number in the stored receipt metadata', async () => {
    const item: QueueItem = {
      ...createItem('pdf-page'),
      file: new File(['pdf'], 'receipt.pdf', { type: 'application/pdf' }),
      sourcePdf: new File(['pdf'], 'receipt.pdf', { type: 'application/pdf' }),
      pageNumber: 2,
      mimeType: 'application/pdf',
      originalName: 'receipt.pdf (Page 2)',
    };
    const harness = createHarness(item);
    let createdReceipt: ReceiptDocument | undefined;
    harness.claim();

    await processClaimedItem(item, harness.dispatch, createServices({
      createReceipt: async (_userId, receipt) => { createdReceipt = receipt; },
    }));

    assert.strictEqual(createdReceipt?.sourcePageNumber, 2);
  });

  test('marks an exact hash match as duplicate without extraction or receipt creation', async () => {
    const item = createItem('duplicate');
    const harness = createHarness(item);
    let extracted = 0;
    let created = 0;
    harness.claim();

    const outcome = await processClaimedItem(item, harness.dispatch, createServices({
      findByHash: async () => [{ id: 'existing-receipt' }],
      extractReceipt: async () => { extracted += 1; return { isReceipt: true }; },
      createReceipt: async () => { created += 1; }
    }));

    assert.strictEqual(outcome, 'continue');
    assert.strictEqual(harness.state[0].status, 'duplicate');
    assert.strictEqual(harness.state[0].receiptId, 'existing-receipt');
    assert.strictEqual(extracted, 0);
    assert.strictEqual(created, 0);
  });

  test('waits after a rate limit, then retries with a fresh single attempt', async () => {
    const firstItem = createItem('retry');
    const harness = createHarness(firstItem);
    harness.claim();
    const limited = await processClaimedItem(firstItem, harness.dispatch, createServices({
      extractReceipt: async () => { throw { status: 429, message: 'cooldown active' }; }
    }));

    assert.strictEqual(limited, 'pause');
    assert.strictEqual(harness.state[0].status, 'retry-wait');
    harness.dispatch({ type: 'RETRY_ITEM', id: 'retry' });
    harness.dispatch({ type: 'START_ATTEMPT', id: 'retry', timestamp: 2 });
    const retriedItem = harness.state[0];
    const retried = await processClaimedItem(retriedItem, harness.dispatch, createServices());

    assert.strictEqual(retried, 'continue');
    assert.strictEqual(harness.state[0].status, 'needs-review');
    assert.strictEqual(harness.state[0].attempts.length, 2);
  });

  test('schedules a server-supplied retry interval for an app-wide limit', async () => {
    const item = createItem('server-retry');
    const harness = createHarness(item);
    harness.claim();
    const before = Date.now();

    const outcome = await processClaimedItem(item, harness.dispatch, createServices({
      extractReceipt: async () => {
        throw { status: 429, message: 'Please wait', retryAfterMs: 9000 };
      },
    }));

    assert.strictEqual(outcome, 'pause');
    assert.strictEqual(harness.state[0].status, 'retry-wait');
    assert.ok((harness.state[0].retryAfter ?? 0) >= before + 9000);
    assert.ok((harness.state[0].retryAfter ?? 0) <= Date.now() + 9000);
  });

  test('cancellation reaches its terminal state and does not create a receipt', async () => {
    const item = createItem('cancel');
    const harness = createHarness(item);
    let created = 0;
    harness.claim();
    const work = processClaimedItem(item, harness.dispatch, createServices({
      preprocessImage: async (_file, signal) => new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
      createReceipt: async () => { created += 1; }
    }));

    await flush();
    item.abortController.abort();
    const outcome = await work;
    assert.strictEqual(outcome, 'stopped');
    assert.strictEqual(harness.state[0].status, 'cancelled');
    assert.strictEqual(created, 0);
  });

  test('sign-out during processing clears the item and blocks review image or receipt creation', async () => {
    const item = createItem('signout');
    const harness = createHarness(item);
    let active = true;
    let releasePreprocess: (() => void) | undefined;
    let created = 0;
    let stored = 0;
    harness.claim();
    const work = processClaimedItem(item, harness.dispatch, createServices({
      preprocessImage: async () => new Promise(resolve => {
        releasePreprocess = () => resolve({ blob: new Blob(['processed']), mimeType: 'image/jpeg' });
      }),
      createReceipt: async () => { created += 1; },
      storeImage: () => { stored += 1; }
    }), () => active);

    await flush();
    active = false;
    harness.dispatch({ type: 'CLEAR_QUEUE' });
    releasePreprocess?.();

    assert.strictEqual(await work, 'stopped');
    assert.deepStrictEqual(harness.state, []);
    assert.strictEqual(created, 0);
    assert.strictEqual(stored, 0);
  });

  test('processes several items sequentially with no repeated claim', async () => {
    let state = [createItem('first'), createItem('second')];
    const claims: string[] = [];
    const processed: string[] = [];
    const releases = new Map<string, () => void>();
    const runnerHolder: { current?: SequentialQueueRunner } = {};

    const runner = new SequentialQueueRunner({
      getNextItem: () => state.find(item => item.status === 'queued'),
      claimItem: item => {
        claims.push(item.id);
        state = queueReducer(state, { type: 'START_ATTEMPT', id: item.id, timestamp: claims.length });
      },
      processItem: item => new Promise<QueueProcessingOutcome>(resolve => {
        processed.push(item.id);
        releases.set(item.id, () => {
          state = queueReducer(state, { type: 'UPDATE_ITEM', id: item.id, updates: { status: 'needs-review' } });
          resolve('continue');
        });
      }),
      canContinue: () => true,
      requestNext: () => { runnerHolder.current?.wake(); }
    });
    runnerHolder.current = runner;

    assert.strictEqual(runner.wake(), true);
    assert.strictEqual(runner.wake(), false);
    assert.deepStrictEqual(processed, ['first']);
    releases.get('first')?.();
    await flush();
    assert.deepStrictEqual(processed, ['first', 'second']);
    releases.get('second')?.();
    await flush();

    assert.deepStrictEqual(claims, ['first', 'second']);
    assert.deepStrictEqual(processed, ['first', 'second']);
    assert.ok(state.every(item => item.status === 'needs-review'));
  });

  test('continues to a later queued item when an earlier item enters retry-wait', async () => {
    let state = [createItem('delayed'), createItem('eligible')];
    const claims: string[] = [];
    const processed: string[] = [];
    const runnerHolder: { current?: SequentialQueueRunner } = {};

    const runner = new SequentialQueueRunner({
      getNextItem: () => state.find(item => item.status === 'queued'),
      claimItem: item => {
        claims.push(item.id);
        state = queueReducer(state, { type: 'START_ATTEMPT', id: item.id, timestamp: claims.length });
      },
      processItem: async item => {
        processed.push(item.id);
        if (item.id === 'delayed') {
          state = queueReducer(state, { type: 'UPDATE_ITEM', id: item.id, updates: { status: 'retry-wait', retryAfter: 100 } });
          return 'pause';
        }
        state = queueReducer(state, { type: 'UPDATE_ITEM', id: item.id, updates: { status: 'needs-review' } });
        return 'continue';
      },
      canContinue: () => true,
      requestNext: () => { runnerHolder.current?.wake(); },
    });
    runnerHolder.current = runner;

    runner.wake();
    await flush();
    await flush();

    assert.deepStrictEqual(claims, ['delayed', 'eligible']);
    assert.deepStrictEqual(processed, ['delayed', 'eligible']);
    assert.strictEqual(state[0].status, 'retry-wait');
    assert.strictEqual(state[1].status, 'needs-review');
  });

  test('invokes browser timer functions with the global receiver', () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let setTimeoutUsesGlobalReceiver = false;
    let clearTimeoutUsesGlobalReceiver = false;
    const fakeHandle = {} as ReturnType<typeof setTimeout>;

    globalThis.setTimeout = (function (this: unknown) {
      setTimeoutUsesGlobalReceiver = this === globalThis;
      return fakeHandle;
    }) as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout = (function (this: unknown) {
      clearTimeoutUsesGlobalReceiver = this === globalThis;
    }) as unknown as typeof globalThis.clearTimeout;

    try {
      const scheduler = new QueueRetryScheduler(() => undefined);
      const retryItem: QueueItem = { ...createItem('timer'), status: 'retry-wait', retryAfter: 100 };
      scheduler.schedule([retryItem], 0);
      scheduler.cancel();

      assert.strictEqual(setTimeoutUsesGlobalReceiver, true);
      assert.strictEqual(clearTimeoutUsesGlobalReceiver, true);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});
