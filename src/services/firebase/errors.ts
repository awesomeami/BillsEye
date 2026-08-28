export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

const SAFE_FIRESTORE_CODES = new Set([
  'already-exists',
  'cancelled',
  'deadline-exceeded',
  'failed-precondition',
  'not-found',
  'permission-denied',
  'resource-exhausted',
  'unauthenticated',
  'unavailable',
]);

export function sanitizeFirestoreErrorCode(error: unknown): string {
  const rawCode = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const normalized = rawCode.toLowerCase().split('/').pop() ?? '';
  return SAFE_FIRESTORE_CODES.has(normalized) ? normalized : 'unknown';
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  _path: string | null,
  _auth: unknown,
): never {
  const code = sanitizeFirestoreErrorCode(error);
  console.error('Firestore operation failed.', { operationType, code });

  const rawMsg = error instanceof Error ? error.message : String(error);

  let friendlyMessage = 'An unexpected database error occurred. Please try again.';

  if (
    code === 'permission-denied' ||
    rawMsg.includes('Missing or insufficient permissions') ||
    rawMsg.includes('permission-denied')
  ) {
    friendlyMessage = "You don't have permission to do that.";
  } else if (
    code === 'unavailable' ||
    rawMsg.includes('offline') ||
    rawMsg.includes('unavailable') ||
    rawMsg.includes('the client is offline')
  ) {
    friendlyMessage = "You're offline — changes will sync later.";
  } else if (code === 'not-found' || rawMsg.includes('not-found')) {
    friendlyMessage = 'The requested item was not found.';
  } else if (
    code === 'resource-exhausted' ||
    rawMsg.includes('Quota exceeded') ||
    rawMsg.includes('resource-exhausted')
  ) {
    friendlyMessage = 'Database quota exceeded. Please try again later.';
  } else if (code === 'unauthenticated' || rawMsg.includes('unauthenticated')) {
    friendlyMessage = 'Authentication required. Please sign in again.';
  } else if (code === 'already-exists') {
    friendlyMessage = 'This item already exists.';
  } else if (code === 'deadline-exceeded') {
    friendlyMessage = 'Database operation timed out. Please try again.';
  } else if (code === 'failed-precondition') {
    friendlyMessage = 'Database operation failed. Please check your data and try again.';
  } else if (code === 'cancelled') {
    friendlyMessage = 'Operation was cancelled.';
  }

  throw new Error(friendlyMessage);
}
