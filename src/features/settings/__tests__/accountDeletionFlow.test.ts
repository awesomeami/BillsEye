import { describe, it } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import {
  accountDeletionUiReducer,
  confirmationForAccountDeletion,
  initialAccountDeletionUiState,
  performAccountDeletion,
  runSingleSubmission,
} from '../accountDeletionFlow';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('account deletion confirmation state', () => {
  it('renders an accessible destructive dialog for both actions', () => {
    for (const action of ['delete_data', 'delete_account'] as const) {
      const confirmation = confirmationForAccountDeletion(action);
      const markup = renderToStaticMarkup(React.createElement(ConfirmDialog, {
        isOpen: true,
        title: confirmation.title,
        message: confirmation.message,
        confirmText: confirmation.confirmText,
        isDestructive: true,
        onConfirm: () => {},
        onCancel: () => {},
      }));

      assert.ok(markup.includes('role="alertdialog"'));
      assert.ok(markup.includes('aria-modal="true"'));
      assert.ok(markup.includes('aria-labelledby="confirm-dialog-title"'));
      assert.ok(markup.includes(confirmation.confirmText));
    }
  });

  it('cancels the dialog without starting a destructive submission', () => {
    const opened = accountDeletionUiReducer(initialAccountDeletionUiState, {
      type: 'open-confirmation',
      confirmation: confirmationForAccountDeletion('delete_account'),
    });
    assert.strictEqual(opened.confirmation?.action, 'delete_account');

    const cancelled = accountDeletionUiReducer(opened, { type: 'cancel-confirmation' });

    assert.strictEqual(cancelled.confirmation, null);
    assert.deepStrictEqual(cancelled.outcome, { status: 'idle' });
  });

  it('rejects a second submission while the first one is pending', async () => {
    const lock = { current: false };
    let submissionCalls = 0;
    let releaseSubmission: (() => void) | undefined;
    const pendingSubmission = new Promise<void>(resolve => {
      releaseSubmission = resolve;
    });

    const first = runSingleSubmission(lock, async () => {
      submissionCalls += 1;
      await pendingSubmission;
      return 'finished';
    });
    const duplicate = await runSingleSubmission(lock, async () => {
      submissionCalls += 1;
      return 'duplicate';
    });

    assert.deepStrictEqual(duplicate, { accepted: false });
    assert.strictEqual(submissionCalls, 1);
    releaseSubmission?.();
    assert.deepStrictEqual(await first, { accepted: true, value: 'finished' });
    assert.strictEqual(lock.current, false);
  });
});

describe('performAccountDeletion', () => {
  it('reauthenticates before sending a fresh token and returns success', async () => {
    const events: string[] = [];
    const fetchMock = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      events.push('fetch');
      assert.strictEqual(init?.headers && (init.headers as Record<string, string>).Authorization, 'Bearer fresh-token');
      assert.deepStrictEqual(JSON.parse(String(init?.body)), { action: 'delete_data' });
      return jsonResponse(200, { success: true, deletedDocuments: 4 });
    }) as typeof fetch;

    const outcome = await performAccountDeletion('delete_data', {
      reauthenticateAndGetIdToken: async () => {
        events.push('reauthenticate');
        return 'fresh-token';
      },
      fetch: fetchMock,
    });

    assert.deepStrictEqual(events, ['reauthenticate', 'fetch']);
    assert.strictEqual(outcome.status, 'success');
  });

  it('does not contact the server when provider reauthentication fails', async () => {
    let fetchCalls = 0;
    const outcome = await performAccountDeletion('delete_account', {
      reauthenticateAndGetIdToken: async () => {
        throw new Error('popup cancelled');
      },
      fetch: (async () => {
        fetchCalls += 1;
        return jsonResponse(200, { success: true });
      }) as typeof fetch,
    });

    assert.strictEqual(outcome.status, 'reauthentication-required');
    assert.strictEqual(fetchCalls, 0);
    assert.ok(!outcome.message.includes('popup cancelled'));
  });

  it('returns the stable server reauthentication-required state', async () => {
    const outcome = await performAccountDeletion('delete_data', {
      reauthenticateAndGetIdToken: async () => 'fresh-token',
      fetch: (async () => jsonResponse(401, {
        error: 'Recent authentication is required before deleting account data.',
        code: 'REAUTHENTICATION_REQUIRED',
      })) as typeof fetch,
    });

    assert.strictEqual(outcome.status, 'reauthentication-required');
  });

  it('maps a revoked or invalid server session to the reauthentication state', async () => {
    const outcome = await performAccountDeletion('delete_account', {
      reauthenticateAndGetIdToken: async () => 'fresh-token',
      fetch: (async () => jsonResponse(401, {
        error: 'Authentication is required before deleting account data.',
        code: 'AUTHENTICATION_REQUIRED',
      })) as typeof fetch,
    });

    assert.strictEqual(outcome.status, 'reauthentication-required');
    assert.ok(outcome.message.includes('Sign in again'));
  });

  it('preserves partial-deletion progress in the client outcome', async () => {
    const outcome = await performAccountDeletion('delete_account', {
      reauthenticateAndGetIdToken: async () => 'fresh-token',
      fetch: (async () => jsonResponse(409, {
        code: 'PARTIAL_DELETION',
        deletedDocuments: 17,
        completedCollections: ['receipts', 'categories'],
        failedStep: 'aliases',
      })) as typeof fetch,
    });

    assert.strictEqual(outcome.status, 'partial-failure');
    if (outcome.status !== 'partial-failure') return;
    assert.deepStrictEqual(outcome.progress, {
      deletedDocuments: 17,
      completedCollections: ['receipts', 'categories'],
      failedStep: 'aliases',
    });
    assert.ok(outcome.message.includes('17 document(s)'));
    assert.ok(outcome.message.includes('aliases'));
  });

  it('returns a clear failure state for an unsuccessful request', async () => {
    const outcome = await performAccountDeletion('delete_data', {
      reauthenticateAndGetIdToken: async () => 'fresh-token',
      fetch: (async () => jsonResponse(500, { error: 'Unable to delete account data.' })) as typeof fetch,
    });

    assert.deepStrictEqual(outcome, {
      status: 'failure',
      action: 'delete_data',
      message: 'Unable to delete account data.',
    });
  });

  it('reports an ambiguous lost response as a partial failure', async () => {
    const outcome = await performAccountDeletion('delete_account', {
      reauthenticateAndGetIdToken: async () => 'fresh-token',
      fetch: (async () => {
        throw new Error('connection reset after request');
      }) as typeof fetch,
    });

    assert.strictEqual(outcome.status, 'partial-failure');
    assert.ok(outcome.message.includes('may have completed'));
    assert.ok(outcome.message.includes('vault was not cleared'));
  });
});
