import { test, describe } from 'node:test';
import assert from 'node:assert';
import { handleFirestoreError, OperationType } from '../errors';

describe('Firestore Error Handling & Formatting', () => {
  const fakeAuth = {
    currentUser: {
      uid: 'user-secret-123',
      email: 'user-private@example.com',
      emailVerified: true,
      isAnonymous: false,
      tenantId: null,
      providerData: [{ providerId: 'google.com', email: 'user-private@example.com' }]
    }
  };

  test('permission-denied throws clean friendly error without leaking uid/email/JSON', () => {
    const rawError = {
      code: 'permission-denied',
      message: 'Missing or insufficient permissions.'
    };

    assert.throws(
      () => {
        handleFirestoreError(rawError, OperationType.GET, 'users/user-secret-123/receipts', fakeAuth);
      },
      (err: any) => {
        assert.strictEqual(err.message, "You don't have permission to do that.");
        assert.ok(!err.message.includes('user-secret-123'));
        assert.ok(!err.message.includes('user-private@example.com'));
        assert.ok(!err.message.startsWith('{'));
        return true;
      }
    );
  });

  test('unavailable / offline error maps to friendly offline message', () => {
    const rawError = {
      code: 'unavailable',
      message: 'Failed to get document because the client is offline.'
    };

    assert.throws(
      () => {
        handleFirestoreError(rawError, OperationType.WRITE, 'users/user-secret-123/categories/cat1', fakeAuth);
      },
      (err: any) => {
        assert.strictEqual(err.message, "You're offline — changes will sync later.");
        assert.ok(!err.message.includes('user-secret-123'));
        return true;
      }
    );
  });

  test('not-found error maps to friendly not found message', () => {
    const rawError = {
      code: 'not-found',
      message: 'No document found'
    };

    assert.throws(
      () => {
        handleFirestoreError(rawError, OperationType.GET, 'users/user-secret-123/receipts/rec1', fakeAuth);
      },
      (err: any) => {
        assert.strictEqual(err.message, 'The requested item was not found.');
        return true;
      }
    );
  });

  test('resource-exhausted error maps to quota message', () => {
    const rawError = {
      code: 'resource-exhausted',
      message: 'Quota exceeded for project'
    };

    assert.throws(
      () => {
        handleFirestoreError(rawError, OperationType.LIST, 'users/user-secret-123/receipts', fakeAuth);
      },
      (err: any) => {
        assert.strictEqual(err.message, 'Database quota exceeded. Please try again later.');
        return true;
      }
    );
  });

  test('unknown generic error maps to fallback message', () => {
    const rawError = new Error('Some unexpected internal error with sensitive token xyz');

    assert.throws(
      () => {
        handleFirestoreError(rawError, OperationType.CREATE, 'users/user-secret-123', fakeAuth);
      },
      (err: any) => {
        assert.strictEqual(err.message, 'An unexpected database error occurred. Please try again.');
        assert.ok(!err.message.includes('sensitive token xyz'));
        assert.ok(!err.message.includes('user-secret-123'));
        return true;
      }
    );
  });
});
