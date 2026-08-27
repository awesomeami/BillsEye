export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, auth: any): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo: auth?.currentUser?.providerData?.map((provider: any) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));

  const code = (error as any)?.code || '';
  const rawMsg = error instanceof Error ? error.message : String(error);

  let friendlyMessage = 'An unexpected database error occurred. Please try again.';

  if (
    code === 'permission-denied' ||
    code.includes('permission-denied') ||
    rawMsg.includes('Missing or insufficient permissions') ||
    rawMsg.includes('permission-denied')
  ) {
    friendlyMessage = "You don't have permission to do that.";
  } else if (
    code === 'unavailable' ||
    code.includes('unavailable') ||
    rawMsg.includes('offline') ||
    rawMsg.includes('unavailable') ||
    rawMsg.includes('the client is offline')
  ) {
    friendlyMessage = "You're offline — changes will sync later.";
  } else if (code === 'not-found' || code.includes('not-found') || rawMsg.includes('not-found')) {
    friendlyMessage = 'The requested item was not found.';
  } else if (
    code === 'resource-exhausted' ||
    code.includes('resource-exhausted') ||
    rawMsg.includes('Quota exceeded') ||
    rawMsg.includes('resource-exhausted')
  ) {
    friendlyMessage = 'Database quota exceeded. Please try again later.';
  } else if (code === 'unauthenticated' || code.includes('unauthenticated') || rawMsg.includes('unauthenticated')) {
    friendlyMessage = 'Authentication required. Please sign in again.';
  } else if (code === 'already-exists' || code.includes('already-exists')) {
    friendlyMessage = 'This item already exists.';
  } else if (code === 'deadline-exceeded' || code.includes('deadline-exceeded')) {
    friendlyMessage = 'Database operation timed out. Please try again.';
  } else if (code === 'failed-precondition' || code.includes('failed-precondition')) {
    friendlyMessage = 'Database operation failed. Please check your data and try again.';
  } else if (code === 'cancelled' || code.includes('cancelled')) {
    friendlyMessage = 'Operation was cancelled.';
  }

  throw new Error(friendlyMessage);
}
