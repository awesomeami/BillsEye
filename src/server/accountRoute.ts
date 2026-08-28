import { Router, Request, Response } from 'express';
import { getFirebaseAdmin } from './firebaseAdmin';
import express from 'express';
import { z } from 'zod';
import {
  DeletionDatabase,
  deleteUserOwnedData,
  UserDeletionError,
  UserDeletionProgress,
} from './accountDeletion';

interface FirebaseAdminForAccountRoute {
  auth: {
    verifyIdToken(token: string): Promise<{ uid: string }>;
    deleteUser(uid: string): Promise<void>;
  };
  db: DeletionDatabase;
}

const AccountActionSchema = z.object({
  action: z.enum(['delete_data', 'delete_account'])
});

function deletionFailureResponse(
  res: Response,
  progress: UserDeletionProgress,
  failedStep: string,
): Response {
  return res.status(409).json({
    error: 'Deletion was only partially completed. Please retry to remove the remaining data.',
    code: 'PARTIAL_DELETION',
    deletedDocuments: progress.deletedDocuments,
    completedCollections: progress.completedCollections,
    failedStep,
  });
}

export function createAccountRouter(
  getAdmin: () => FirebaseAdminForAccountRoute = () => getFirebaseAdmin() as unknown as FirebaseAdminForAccountRoute,
) {
  const router = Router();
  router.use(express.json({ limit: '100kb' }));

  router.post('/delete', async (req: Request, res: Response): Promise<any> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.split('Bearer ')[1];
    let decodedToken: { uid: string };
    try {
      decodedToken = await getAdmin().auth.verifyIdToken(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired Firebase ID token' });
    }

    const uid = decodedToken.uid;
    
    // Zod validation
    const parsedBody = AccountActionSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: 'Invalid action payload' });
    }
    
    const { action } = parsedBody.data;

    const admin = getAdmin();
    let progress: UserDeletionProgress;
    try {
      progress = await deleteUserOwnedData(admin.db, uid);
    } catch (error) {
      if (error instanceof UserDeletionError) {
        return deletionFailureResponse(res, error.progress, error.failedCollection);
      }
      return res.status(500).json({ error: 'Unable to delete account data.' });
    }

    if (action === 'delete_account') {
      try {
        await admin.db.collection('users').doc(uid).delete();
        progress.deletedDocuments += 1;
      } catch {
        return deletionFailureResponse(res, progress, 'profile');
      }
      try {
        await admin.auth.deleteUser(uid);
      } catch {
        return deletionFailureResponse(res, progress, 'authentication');
      }
    }

    return res.status(200).json({ success: true, deletedDocuments: progress.deletedDocuments });
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
  });

  return router;
}

const router = createAccountRouter();

export default router;
