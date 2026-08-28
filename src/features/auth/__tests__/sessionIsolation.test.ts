import assert from 'node:assert';
import { describe, test } from 'node:test';
import {
  ActiveSessionGuard,
  ClientSessionActionGuard,
  SequencedAsyncSubscription,
} from '../../../services/firebase/subscriptionIsolation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('client session and snapshot isolation', () => {
  test('a deferred callback for an old UID cannot update the new active session', async () => {
    const guard = new ActiveSessionGuard();
    const oldScope = guard.activate('old-user');
    const oldHydration = deferred<string>();
    const updates: string[] = [];
    const oldSubscription = new SequencedAsyncSubscription<string, string>({
      hydrate: () => oldHydration.promise,
      onUpdate: value => {
        if (guard.isActive(oldScope)) updates.push(value);
      },
      onError: () => undefined,
    });
    oldSubscription.next('old snapshot');

    const newScope = guard.activate('new-user');
    const newHydration = deferred<string>();
    const newSubscription = new SequencedAsyncSubscription<string, string>({
      hydrate: () => newHydration.promise,
      onUpdate: value => {
        if (guard.isActive(newScope)) updates.push(value);
      },
      onError: () => undefined,
    });
    newSubscription.next('new snapshot');
    newHydration.resolve('new data');
    await flushPromises();
    oldHydration.resolve('old data');
    await flushPromises();

    assert.deepStrictEqual(updates, ['new data']);
  });

  test('an older snapshot cannot overwrite a newer snapshot that hydrates first', async () => {
    const older = deferred<string>();
    const newer = deferred<string>();
    const updates: string[] = [];
    const subscription = new SequencedAsyncSubscription<'older' | 'newer', string>({
      hydrate: snapshot => snapshot === 'older' ? older.promise : newer.promise,
      onUpdate: value => updates.push(value),
      onError: () => undefined,
    });

    subscription.next('older');
    subscription.next('newer');
    newer.resolve('new data');
    await flushPromises();
    older.resolve('old data');
    await flushPromises();

    assert.deepStrictEqual(updates, ['new data']);
  });

  test('unsubscription invalidates pending hydration and errors', async () => {
    const hydration = deferred<string>();
    const updates: string[] = [];
    const errors: unknown[] = [];
    const subscription = new SequencedAsyncSubscription<string, string>({
      hydrate: () => hydration.promise,
      onUpdate: value => updates.push(value),
      onError: error => errors.push(error),
    });

    subscription.next('snapshot');
    subscription.deactivate();
    subscription.fail(new Error('late listener failure'));
    hydration.resolve('late data');
    await flushPromises();

    const rejected = deferred<string>();
    const rejectedSubscription = new SequencedAsyncSubscription<string, string>({
      hydrate: () => rejected.promise,
      onUpdate: value => updates.push(value),
      onError: error => errors.push(error),
    });
    rejectedSubscription.next('snapshot');
    rejectedSubscription.deactivate();
    rejected.reject(new Error('late failure'));
    await flushPromises();

    assert.deepStrictEqual(updates, []);
    assert.deepStrictEqual(errors, []);
  });

  test('a terminal listener error invalidates hydration already in flight', async () => {
    const hydration = deferred<string>();
    const updates: string[] = [];
    const errors: string[] = [];
    const subscription = new SequencedAsyncSubscription<string, string>({
      hydrate: () => hydration.promise,
      onUpdate: value => updates.push(value),
      onError: error => errors.push((error as Error).message),
    });

    subscription.next('snapshot');
    subscription.fail(new Error('listener closed'));
    hydration.resolve('late data');
    await flushPromises();

    assert.deepStrictEqual(updates, []);
    assert.deepStrictEqual(errors, ['listener closed']);
  });

  test('a deferred receipt action cannot run global effects after logout and login', async () => {
    const action = deferred<void>();
    const guard = new ClientSessionActionGuard();
    guard.update('user-a', 1);
    const scope = guard.capture();
    assert.ok(scope);
    const globalEffects: string[] = [];
    const completion = action.promise.then(() => {
      if (guard.isActive(scope)) globalEffects.push('navigate-or-toast');
    });

    guard.update(null, 2);
    guard.update('user-b', 3);
    action.resolve();
    await completion;

    assert.deepStrictEqual(globalEffects, []);
  });
});
