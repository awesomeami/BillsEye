import { Router, Request, Response } from 'express';
import { getFirebaseAdmin } from './firebaseAdmin';


import express from 'express';
import { z } from 'zod';


const router = Router();
router.use(express.json({ limit: '100kb' })); // Limit body size

const AccountActionSchema = z.object({
  action: z.enum(['delete_data', 'delete_account'])
});

router.post('/delete', async (req: Request, res: Response): Promise<any> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await getFirebaseAdmin().auth.verifyIdToken(token);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired Firebase ID token' });
    }

    const uid = decodedToken.uid;
    
    // Zod validation
    const parsedBody = AccountActionSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: 'Invalid action payload' });
    }
    
    const { action } = parsedBody.data;

    const db = getFirebaseAdmin().db;

    const deleteDocs = async (collectionPath: string) => {
      const snapshot = await db.collection(collectionPath).get();
      const MAX_BATCH_SIZE = 500;
      let currentBatch = db.batch();
      let count = 0;
      
      for (const doc of snapshot.docs) {
        currentBatch.delete(doc.ref);
        count++;
        if (count === MAX_BATCH_SIZE) {
          await currentBatch.commit();
          currentBatch = db.batch();
          count = 0;
        }
      }
      if (count > 0) {
        await currentBatch.commit();
      }
    };

    // 1. Delete all Firestore data for user
    await deleteDocs(`users/${uid}/receipts`);
    await deleteDocs(`users/${uid}/categories`);
    await deleteDocs(`users/${uid}/aliases`);
    await deleteDocs(`users/${uid}/settings`);

    if (action === 'delete_account') {
      await db.collection('users').doc(uid).delete();
      
      await getFirebaseAdmin().auth.deleteUser(uid);
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: 'Internal Server Error' }); // Do not leak error
  }
});

export default router;
