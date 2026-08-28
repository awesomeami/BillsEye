import { describe, test } from 'node:test';
import assert from 'node:assert';
import { isRetryableQueueStatus, queueReducer, QueueItem } from '../queueReducer';

describe('queueReducer', () => {
  const createMockItem = (id: string, status: QueueItem['status'] = 'queued', objectUrl = `blob:http://localhost/${id}`, abortController = new AbortController()): QueueItem => ({
    id,
    file: new File([''], `${id}.jpg`, { type: 'image/jpeg' }),
    originalName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    objectUrl,
    status,
    progress: 0,
    attempts: [],
    abortController
  });

  test('adds items to the queue', () => {
    const initialState: QueueItem[] = [];
    const item = createMockItem('1');
    const newState = queueReducer(initialState, { type: 'ADD_ITEMS', items: [item] });
    assert.strictEqual(newState.length, 1);
    assert.strictEqual(newState[0].id, '1');
    assert.strictEqual(newState[0].status, 'queued');
  });

  test('updates item state and progress', () => {
    const initialState: QueueItem[] = [createMockItem('1')];
    const newState = queueReducer(initialState, { type: 'UPDATE_ITEM', id: '1', updates: { status: 'preprocessing', progress: 50 } });
    assert.strictEqual(newState[0].status, 'preprocessing');
    assert.strictEqual(newState[0].progress, 50);
  });

  test('claims a queued item once and records the attempt', () => {
    const initialState: QueueItem[] = [createMockItem('1')];
    const claimed = queueReducer(initialState, { type: 'START_ATTEMPT', id: '1', timestamp: 100 });
    const claimedAgain = queueReducer(claimed, { type: 'START_ATTEMPT', id: '1', timestamp: 200 });

    assert.strictEqual(claimed[0].status, 'preprocessing');
    assert.deepStrictEqual(claimed[0].attempts, [{ timestamp: 100 }]);
    assert.deepStrictEqual(claimedAgain[0].attempts, [{ timestamp: 100 }]);
  });

  test('removes item state without duplicating provider-owned resource cleanup', () => {
    const initialState: QueueItem[] = [
      createMockItem('1', 'extracting', 'blob:http://localhost/test1234')
    ];

    const newState = queueReducer(initialState, { type: 'REMOVE_ITEM', id: '1' });
    assert.strictEqual(newState.length, 0);
  });

  test('marks an inflight item as cancelled', () => {
    const initialState: QueueItem[] = [
      { ...createMockItem('1', 'extracting', 'blob:http://localhost/test1'), progress: 50 }
    ];
    
    const newState = queueReducer(initialState, { type: 'CANCEL_ITEM', id: '1' });
    assert.strictEqual(newState[0].status, 'cancelled');
  });

  test('retries a delayed item and resets error and retry state', () => {
    const initialState: QueueItem[] = [
      {
        ...createMockItem('1', 'retry-wait'),
        error: 'Network error',
        retryAfter: 12345
      }
    ];
    
    const newState = queueReducer(initialState, { type: 'RETRY_ITEM', id: '1' });
    assert.strictEqual(newState[0].status, 'queued');
    assert.strictEqual(newState[0].error, undefined);
    assert.strictEqual(newState[0].retryAfter, undefined);
    assert.ok(newState[0].abortController);
  });

  test('makes only expired scheduled retries eligible with a fresh controller', () => {
    const expired = { ...createMockItem('expired', 'retry-wait'), retryAfter: 100 };
    const delayed = { ...createMockItem('delayed', 'retry-wait'), retryAfter: 200 };
    const previousController = expired.abortController;

    const state = queueReducer([expired, delayed], { type: 'RETRY_DUE', now: 100 });

    assert.strictEqual(state[0].status, 'queued');
    assert.strictEqual(state[0].retryAfter, undefined);
    assert.notStrictEqual(state[0].abortController, previousController);
    assert.strictEqual(state[1].status, 'retry-wait');
  });

  test('identifies only a scheduled retry as retryable', () => {
    assert.strictEqual(isRetryableQueueStatus('retry-wait'), true);
    assert.strictEqual(isRetryableQueueStatus('failed-permanent'), false);
    assert.strictEqual(isRetryableQueueStatus('duplicate'), false);
  });

  test('clears every queue item at an auth boundary', () => {
    const state = [createMockItem('1'), createMockItem('2', 'retry-wait')];
    assert.deepStrictEqual(queueReducer(state, { type: 'CLEAR_QUEUE' }), []);
  });
});
