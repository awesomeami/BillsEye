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
    verifyIdToken(token: string, checkRevoked?: boolean): Promise<{
      uid: string;
      auth_time?: unknown;
    }>;
    deleteUser(uid: string): Promise<void>;
  };
  db: DeletionDatabase;
}

const AccountActionSchema = z.object({
  action: z.enum(['delete_data', 'delete_account'])
}).strict();

/**
 * Destructive account actions require a Google/Firebase authentication event
 * within the last five minutes. Refreshing an ID token does not change its
 * signed auth_time, so this cannot be satisfied by a token refresh alone.
 */
export const RECENT_AUTH_MAX_AGE_SECONDS = 5 * 60;
const AUTH_TIME_CLOCK_SKEW_SECONDS = 60;

export function hasRecentAuthentication(
  decodedToken: { auth_time?: unknown },
  nowSeconds: number,
): boolean {
  const authTime = decodedToken.auth_time;
  if (typeof authTime !== 'number' || !Number.isSafeInteger(authTime) || authTime <= 0) return false;

  const ageSeconds = nowSeconds - authTime;
  return ageSeconds >= -AUTH_TIME_CLOCK_SKEW_SECONDS
    && ageSeconds <= RECENT_AUTH_MAX_AGE_SECONDS;
}

function reauthenticationRequiredResponse(res: Response): Response {
  return res.status(401).json({
    error: 'Recent authentication is required before deleting account data.',
    code: 'REAUTHENTICATION_REQUIRED',
  });
}

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
  nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
) {
  const router = Router();
  router.use(express.json({ limit: '100kb' }));

  router.post('/delete', async (req: Request, res: Response): Promise<Response> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    let admin: FirebaseAdminForAccountRoute;
    try {
      admin = getAdmin();
    } catch {
      return res.status(503).json({
        error: 'Account service is temporarily unavailable.',
        code: 'CONFIGURATION_UNAVAILABLE',
      });
    }
    let decodedToken: { uid: string; auth_time?: unknown };
    try {
      decodedToken = await admin.auth.verifyIdToken(token, true);
    } catch {
      return res.status(401).json({
        error: 'Authentication is required before deleting account data.',
        code: 'AUTHENTICATION_REQUIRED',
      });
    }
    
    // Zod validation
    const parsedBody = AccountActionSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: 'Invalid action payload' });
    }
    
    const { action } = parsedBody.data;

    if (!hasRecentAuthentication(decodedToken, nowSeconds())) {
      return reauthenticationRequiredResponse(res);
    }

    // The target identity is derived only from the revocation-checked token.
    const uid = decodedToken.uid;

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
