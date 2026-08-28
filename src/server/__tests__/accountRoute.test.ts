import { describe, it } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import { DeletionBatch, DeletionCollectionReference, DeletionDatabase, DeletionDocumentReference } from '../accountDeletion';
import { createAccountRouter, RECENT_AUTH_MAX_AGE_SECONDS } from '../accountRoute';

class EmptyDatabase implements DeletionDatabase {
  readonly accessedCollections: string[] = [];
  readonly deletedReferences: string[] = [];

  collection(path: string): DeletionCollectionReference {
    this.accessedCollections.push(path);
    return {
      get: async () => ({ docs: [] }),
      doc: (id: string) => this.reference(`${path}/${id}`),
    };
  }

  batch(): DeletionBatch {
    return {
      delete: () => {},
      commit: async () => {},
    };
  }

  private reference(path: string): DeletionDocumentReference {
    return {
      collection: (childPath: string) => this.collection(`${path}/${childPath}`),
      delete: async () => {
        this.deletedReferences.push(path);
      },
    };
  }
}

interface RouteHarnessOptions {
  verifyIdToken: (token: string, checkRevoked?: boolean) => Promise<{
    uid: string;
    auth_time?: unknown;
  }>;
  nowSeconds?: number;
}

function createRouteHarness(options: RouteHarnessOptions) {
  const db = new EmptyDatabase();
  const deletedUsers: string[] = [];
  const app = express();
  app.use('/api/account', createAccountRouter(() => ({
    db,
    auth: {
      verifyIdToken: options.verifyIdToken,
      deleteUser: async (uid: string) => {
        deletedUsers.push(uid);
      },
    },
  }), () => options.nowSeconds ?? 10_000));
  return { app, db, deletedUsers };
}

function postDeletion(app: express.Express, body: unknown) {
  return request(app)
    .post('/api/account/delete')
    .set('Authorization', 'Bearer test-token')
    .send(body as object);
}

describe('Account Deletion Route authentication', () => {
  it('checks revocation and rejects revoked tokens without exposing verifier details', async () => {
    let checkRevoked: boolean | undefined;
    const { app, db } = createRouteHarness({
      verifyIdToken: async (_token, requestedRevocationCheck) => {
        checkRevoked = requestedRevocationCheck;
        throw new Error('auth/id-token-revoked secret@example.test');
      },
    });

    const response = await postDeletion(app, { action: 'delete_data' });

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.code, 'AUTHENTICATION_REQUIRED');
    assert.strictEqual(checkRevoked, true);
    assert.ok(!JSON.stringify(response.body).includes('id-token-revoked'));
    assert.ok(!JSON.stringify(response.body).includes('secret@example.test'));
    assert.deepStrictEqual(db.accessedCollections, []);
  });

  it('rejects a verified token with missing auth_time', async () => {
    const { app, db } = createRouteHarness({
      verifyIdToken: async () => ({ uid: 'verified-user' }),
    });

    const response = await postDeletion(app, { action: 'delete_data' });

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.code, 'REAUTHENTICATION_REQUIRED');
    assert.deepStrictEqual(db.accessedCollections, []);
  });

  it('rejects a stale auth_time before touching user data', async () => {
    const nowSeconds = 10_000;
    const { app, db } = createRouteHarness({
      nowSeconds,
      verifyIdToken: async () => ({
        uid: 'verified-user',
        auth_time: nowSeconds - RECENT_AUTH_MAX_AGE_SECONDS - 1,
      }),
    });

    const response = await postDeletion(app, { action: 'delete_account' });

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.code, 'REAUTHENTICATION_REQUIRED');
    assert.deepStrictEqual(db.accessedCollections, []);
  });

  it('accepts auth_time at the recent-auth boundary for both destructive actions', async () => {
    const nowSeconds = 10_000;
    for (const action of ['delete_data', 'delete_account'] as const) {
      const verifiedTokens: Array<{ token: string; checkRevoked: boolean | undefined }> = [];
      const { app, db, deletedUsers } = createRouteHarness({
        nowSeconds,
        verifyIdToken: async (token, checkRevoked) => {
          verifiedTokens.push({ token, checkRevoked });
          return {
            uid: 'token-derived-user',
            auth_time: nowSeconds - RECENT_AUTH_MAX_AGE_SECONDS,
          };
        },
      });

      const response = await postDeletion(app, { action });

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(verifiedTokens, [{ token: 'test-token', checkRevoked: true }]);
      assert.ok(db.accessedCollections.every(path => !path.includes('payload-user')));
      if (action === 'delete_account') {
        assert.deepStrictEqual(db.deletedReferences, ['users/token-derived-user']);
        assert.deepStrictEqual(deletedUsers, ['token-derived-user']);
      } else {
        assert.deepStrictEqual(db.deletedReferences, []);
        assert.deepStrictEqual(deletedUsers, []);
      }
    }
  });
});

describe('Account Deletion Route payload validation', () => {
  it('rejects wrong and identity-bearing payloads before deletion', async () => {
    const wrongPayloads: unknown[] = [
      {},
      null,
      { action: 'delete_everything' },
      { action: 'delete_data', uid: 'payload-user' },
    ];

    for (const body of wrongPayloads) {
      const { app, db, deletedUsers } = createRouteHarness({
        verifyIdToken: async () => ({ uid: 'token-derived-user', auth_time: 10_000 }),
      });

      const response = await postDeletion(app, body);

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'Invalid action payload');
      assert.deepStrictEqual(db.accessedCollections, []);
      assert.deepStrictEqual(deletedUsers, []);
    }
  });
});
