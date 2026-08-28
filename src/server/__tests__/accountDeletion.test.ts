import { describe, it } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import {
  DeletionBatch,
  DeletionCollectionReference,
  DeletionDatabase,
  DeletionDocumentReference,
  deleteUserOwnedData,
  UserDeletionError,
} from '../accountDeletion';
import { createAccountRouter } from '../accountRoute';

class FakeDatabase implements DeletionDatabase {
  readonly documents = new Map<string, FakeReference[]>();
  readonly commits: string[][] = [];
  failNextCommit = false;
  recursiveDelete?: (ref: DeletionCollectionReference) => Promise<void>;

  add(path: string, id: string): FakeReference {
    const ref = new FakeReference(this, `${path}/${id}`);
    const docs = this.documents.get(path) ?? [];
    docs.push(ref);
    this.documents.set(path, docs);
    return ref;
  }

  collection(path: string): DeletionCollectionReference {
    return {
      get: async () => ({ docs: (this.documents.get(path) ?? []).map(ref => ({ ref })) }),
      doc: (id: string) => new FakeReference(this, `${path}/${id}`),
    };
  }

  batch(): DeletionBatch {
    const pending: FakeReference[] = [];
    return {
      delete: (ref) => pending.push(ref as FakeReference),
      commit: async () => {
        if (this.failNextCommit) {
          this.failNextCommit = false;
          throw new Error('simulated batch failure');
        }
        this.commits.push(pending.map(ref => ref.path));
      },
    };
  }
}

class FakeReference implements DeletionDocumentReference {
  constructor(readonly db: FakeDatabase, readonly path: string) {}

  collection(path: string): DeletionCollectionReference {
    return this.db.collection(`${this.path}/${path}`);
  }

  async delete(): Promise<void> {
    this.db.commits.push([this.path]);
  }
}

describe('deleteUserOwnedData', () => {
  it('delegates receipt descendants to the Admin recursive deletion path when available', async () => {
    const db = new FakeDatabase();
    let recursiveDeleteCalls = 0;
    db.recursiveDelete = async () => {
      recursiveDeleteCalls += 1;
    };

    const result = await deleteUserOwnedData(db, 'user-1');

    assert.strictEqual(recursiveDeleteCalls, 1);
    assert.deepStrictEqual(result.completedCollections, ['receipts', 'categories', 'aliases', 'settings']);
  });

  it('deletes receipt items before their parent and splits large collections into 500-write batches', async () => {
    const db = new FakeDatabase();
    const receipt = db.add('users/user-1/receipts', 'receipt-1');
    db.add(`${receipt.path}/items`, '0');
    db.add(`${receipt.path}/items`, '1');
    for (let index = 0; index < 501; index += 1) {
      db.add('users/user-1/categories', `category-${index}`);
    }

    const result = await deleteUserOwnedData(db, 'user-1');

    assert.deepStrictEqual(result.completedCollections, ['receipts', 'categories', 'aliases', 'settings']);
    assert.strictEqual(result.deletedDocuments, 504);
    assert.deepStrictEqual(db.commits.map(batch => batch.length), [3, 500, 1]);
    assert.deepStrictEqual(db.commits[0], [
      'users/user-1/receipts/receipt-1/items/0',
      'users/user-1/receipts/receipt-1/items/1',
      'users/user-1/receipts/receipt-1',
    ]);
  });

  it('reports committed progress when a later collection fails so a retry is safe', async () => {
    const db = new FakeDatabase();
    db.add('users/user-1/receipts', 'receipt-1');
    db.add('users/user-1/categories', 'category-1');

    const originalBatch = db.batch.bind(db);
    let batchCount = 0;
    db.batch = () => {
      const batch = originalBatch();
      const commit = batch.commit;
      batch.commit = async () => {
        batchCount += 1;
        if (batchCount === 2) throw new Error('simulated category failure');
        await commit();
      };
      return batch;
    };

    await assert.rejects(
      deleteUserOwnedData(db, 'user-1'),
      (error: unknown) => {
        assert.ok(error instanceof UserDeletionError);
        assert.deepStrictEqual(error.progress, { deletedDocuments: 1, completedCollections: ['receipts'] });
        assert.strictEqual(error.failedCollection, 'categories');
        return true;
      },
    );
  });

  it('includes batches already committed in the collection that later fails', async () => {
    const db = new FakeDatabase();
    for (let index = 0; index < 501; index += 1) {
      db.add('users/user-1/categories', `category-${index}`);
    }
    const originalBatch = db.batch.bind(db);
    let batchCount = 0;
    db.batch = () => {
      const batch = originalBatch();
      const commit = batch.commit;
      batch.commit = async () => {
        batchCount += 1;
        if (batchCount === 2) throw new Error('simulated final batch failure');
        await commit();
      };
      return batch;
    };

    await assert.rejects(
      deleteUserOwnedData(db, 'user-1'),
      (error: unknown) => {
        assert.ok(error instanceof UserDeletionError);
        assert.deepStrictEqual(error.progress, {
          deletedDocuments: 500,
          completedCollections: ['receipts'],
        });
        assert.strictEqual(error.failedCollection, 'categories');
        return true;
      },
    );
  });
});

describe('account deletion route', () => {
  it('reports partial failure for the token-derived user without deleting another namespace', async () => {
    const db = new FakeDatabase();
    db.add('users/verified-user/receipts', 'receipt-1');
    db.add('users/verified-user/categories', 'category-1');
    db.add('users/other-user/receipts', 'other-receipt');
    const originalBatch = db.batch.bind(db);
    let batchCount = 0;
    db.batch = () => {
      const batch = originalBatch();
      const commit = batch.commit;
      batch.commit = async () => {
        batchCount += 1;
        if (batchCount === 2) throw new Error('simulated category failure');
        await commit();
      };
      return batch;
    };
    const app = express();
    app.use('/api/account', createAccountRouter(() => ({
      db,
      auth: {
        verifyIdToken: async () => ({
          uid: 'verified-user',
          auth_time: Math.floor(Date.now() / 1000),
        }),
        deleteUser: async () => {},
      },
    })));

    const response = await request(app)
      .post('/api/account/delete')
      .set('Authorization', 'Bearer valid-token')
      .send({ action: 'delete_data' });

    assert.strictEqual(response.status, 409);
    assert.strictEqual(response.body.code, 'PARTIAL_DELETION');
    assert.strictEqual(response.body.deletedDocuments, 1);
    assert.deepStrictEqual(response.body.completedCollections, ['receipts']);
    assert.strictEqual(response.body.failedStep, 'categories');
    assert.ok(!db.commits.flat().some(path => path.includes('other-user')));
  });
});
