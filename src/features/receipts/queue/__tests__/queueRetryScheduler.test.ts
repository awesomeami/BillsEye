import { describe, test } from 'node:test';
import assert from 'node:assert';
import { QueueItem } from '../queueReducer';
import { QueueRetryScheduler, RetryTimer } from '../queueProcessor';

class FakeTimers implements RetryTimer {
  now = 0;
  private nextHandle = 1;
  private scheduled = new Map<number, { dueAt: number; callback: () => void }>();

  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const handle = this.nextHandle++;
    this.scheduled.set(handle, { dueAt: this.now + delayMs, callback });
    return handle as unknown as ReturnType<typeof setTimeout>;
  }

  clearTimeout(handle: ReturnType<typeof setTimeout>) {
    this.scheduled.delete(handle as unknown as number);
  }

  advanceBy(milliseconds: number) {
    this.now += milliseconds;
    const due = [...this.scheduled.entries()]
      .filter(([, timer]) => timer.dueAt <= this.now)
      .sort(([, left], [, right]) => left.dueAt - right.dueAt);
    due.forEach(([handle, timer]) => {
      this.scheduled.delete(handle);
      timer.callback();
    });
  }
}

function retryItem(id: string, retryAfter: number): QueueItem {
  return {
    id,
    file: new Blob(['receipt'], { type: 'image/jpeg' }),
    originalName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    status: 'retry-wait',
    retryAfter,
    abortController: new AbortController(),
    attempts: [],
  };
}

describe('QueueRetryScheduler', () => {
  test('uses a cancellable fake timer for the earliest retry and does not fire early', () => {
    const timers = new FakeTimers();
    let wakes = 0;
    const scheduler = new QueueRetryScheduler(() => { wakes += 1; }, timers);

    scheduler.schedule([retryItem('later', 200), retryItem('first', 100)], timers.now);
    timers.advanceBy(99);
    assert.strictEqual(wakes, 0);

    timers.advanceBy(1);
    assert.strictEqual(wakes, 1);

    scheduler.schedule([retryItem('cancelled', 200)], timers.now);
    scheduler.cancel();
    timers.advanceBy(200);
    assert.strictEqual(wakes, 1);
  });
});
