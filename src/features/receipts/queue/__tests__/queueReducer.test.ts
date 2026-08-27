import { describe, test } from 'node:test';
import assert from 'node:assert';
import { queueReducer, QueueItem } from '../queueReducer';

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

  test('removes item, aborts inflight controller, and cleans up objectUrl', () => {
    let aborted = false;
    let revokedUrl = '';
    const originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => {
      revokedUrl = url;
    };

    const mockController = {
      abort: () => {
        aborted = true;
      }
    } as unknown as AbortController;

    const initialState: QueueItem[] = [
      {
        ...createMockItem('1', 'extracting', 'blob:http://localhost/test1234', mockController),
        progress: 30
      }
    ];
    
    try {
      const newState = queueReducer(initialState, { type: 'REMOVE_ITEM', id: '1' });
      assert.strictEqual(newState.length, 0);
      assert.strictEqual(aborted, true);
      assert.strictEqual(revokedUrl, 'blob:http://localhost/test1234');
    } finally {
      URL.revokeObjectURL = originalRevoke;
    }
  });

  test('cancels inflight item and sets status to cancelled', () => {
    let aborted = false;
    const mockController = {
      abort: () => {
        aborted = true;
      }
    } as unknown as AbortController;

    const initialState: QueueItem[] = [
      {
        ...createMockItem('1', 'extracting', 'blob:http://localhost/test1', mockController),
        progress: 50
      }
    ];
    
    const newState = queueReducer(initialState, { type: 'CANCEL_ITEM', id: '1' });
    assert.strictEqual(newState[0].status, 'cancelled');
    assert.strictEqual(aborted, true);
  });

  test('retries failed item and resets error and retry state', () => {
    const initialState: QueueItem[] = [
      {
        ...createMockItem('1', 'failed-permanent'),
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
});
