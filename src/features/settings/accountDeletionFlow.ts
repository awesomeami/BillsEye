export type AccountDeletionAction = 'delete_data' | 'delete_account';

export interface AccountDeletionConfirmation {
  action: AccountDeletionAction;
  title: string;
  message: string;
  confirmText: string;
}

export interface PartialDeletionProgress {
  deletedDocuments: number;
  completedCollections: string[];
  failedStep: string | null;
}

export type AccountDeletionOutcome =
  | { status: 'idle' }
  | { status: 'pending'; action: AccountDeletionAction; message: string }
  | { status: 'success'; action: AccountDeletionAction; message: string }
  | {
      status: 'partial-failure';
      action: AccountDeletionAction;
      message: string;
      progress: PartialDeletionProgress | null;
    }
  | { status: 'reauthentication-required'; action: AccountDeletionAction; message: string }
  | { status: 'failure'; action: AccountDeletionAction; message: string };

export interface AccountDeletionUiState {
  confirmation: AccountDeletionConfirmation | null;
  outcome: AccountDeletionOutcome;
}

export const initialAccountDeletionUiState: AccountDeletionUiState = {
  confirmation: null,
  outcome: { status: 'idle' },
};

export type AccountDeletionUiEvent =
  | { type: 'open-confirmation'; confirmation: AccountDeletionConfirmation }
  | { type: 'cancel-confirmation' }
  | { type: 'submission-started'; action: AccountDeletionAction }
  | { type: 'submission-finished'; outcome: AccountDeletionOutcome };

export function accountDeletionUiReducer(
  state: AccountDeletionUiState,
  event: AccountDeletionUiEvent,
): AccountDeletionUiState {
  switch (event.type) {
    case 'open-confirmation':
      if (state.outcome.status === 'pending') return state;
      return { confirmation: event.confirmation, outcome: { status: 'idle' } };
    case 'cancel-confirmation':
      return { ...state, confirmation: null };
    case 'submission-started':
      return {
        confirmation: null,
        outcome: {
          status: 'pending',
          action: event.action,
          message: 'Confirming your identity before deletion…',
        },
      };
    case 'submission-finished':
      return { confirmation: null, outcome: event.outcome };
  }
}

export function confirmationForAccountDeletion(
  action: AccountDeletionAction,
): AccountDeletionConfirmation {
  return action === 'delete_data'
    ? {
        action,
        title: 'Delete cloud data?',
        message: 'Delete your receipts, categories, aliases, and settings? Your profile and local Gemini vault will remain. This cannot be undone.',
        confirmText: 'Delete cloud data',
      }
    : {
        action,
        title: 'Delete account?',
        message: 'Delete your account and all associated cloud data? Your local Gemini vault will also be cleared. This cannot be undone.',
        confirmText: 'Delete account',
      };
}

interface AccountDeletionDependencies {
  reauthenticateAndGetIdToken: () => Promise<string>;
  fetch: typeof fetch;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function safeErrorMessage(payload: JsonRecord | null, fallback: string): string {
  return typeof payload?.error === 'string' && payload.error.trim()
    ? payload.error
    : fallback;
}

function partialProgress(payload: JsonRecord): PartialDeletionProgress {
  return {
    deletedDocuments: Number.isSafeInteger(payload.deletedDocuments) && (payload.deletedDocuments as number) >= 0
      ? payload.deletedDocuments as number
      : 0,
    completedCollections: Array.isArray(payload.completedCollections)
      ? payload.completedCollections.filter((value): value is string => typeof value === 'string')
      : [],
    failedStep: typeof payload.failedStep === 'string' ? payload.failedStep : null,
  };
}

function partialFailureMessage(progress: PartialDeletionProgress): string {
  const completed = progress.completedCollections.length > 0
    ? ` Completed: ${progress.completedCollections.join(', ')}.`
    : '';
  const failed = progress.failedStep ? ` The deletion stopped at ${progress.failedStep}.` : '';
  return `Deletion was only partially completed (${progress.deletedDocuments} document(s) removed).${completed}${failed} Retry to remove the remaining data.`;
}

export async function performAccountDeletion(
  action: AccountDeletionAction,
  dependencies: AccountDeletionDependencies,
): Promise<AccountDeletionOutcome> {
  let token: string;
  try {
    token = await dependencies.reauthenticateAndGetIdToken();
    if (!token) throw new Error('Missing token after reauthentication.');
  } catch {
    return {
      status: 'reauthentication-required',
      action,
      message: 'Recent Google authentication is required. Try again and complete the sign-in prompt.',
    };
  }

  let response: Response;
  try {
    response = await dependencies.fetch('/api/account/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action }),
    });
  } catch {
    return {
      status: 'partial-failure',
      action,
      progress: null,
      message: action === 'delete_account'
        ? 'The server response was not received, so account deletion may have completed. The local Gemini vault was not cleared. If you can still sign in, retry safely.'
        : 'The server response was not received, so cloud-data deletion may be partially or fully complete. Retry safely to remove anything remaining.',
    };
  }

  const payload = asRecord(await response.json().catch(() => null));
  if (response.ok) {
    return {
      status: 'success',
      action,
      message: action === 'delete_data'
        ? 'Receipt, category, alias, and settings data was deleted successfully.'
        : 'Your cloud data and account were deleted successfully.',
    };
  }

  if (payload?.code === 'REAUTHENTICATION_REQUIRED') {
    return {
      status: 'reauthentication-required',
      action,
      message: 'Your authentication is no longer recent enough. Try again and complete the Google sign-in prompt.',
    };
  }

  if (payload?.code === 'AUTHENTICATION_REQUIRED') {
    return {
      status: 'reauthentication-required',
      action,
      message: 'Your session is no longer valid. Sign in again before retrying this deletion.',
    };
  }

  if (payload?.code === 'PARTIAL_DELETION') {
    const progress = partialProgress(payload);
    return {
      status: 'partial-failure',
      action,
      progress,
      message: partialFailureMessage(progress),
    };
  }

  return {
    status: 'failure',
    action,
    message: safeErrorMessage(payload, 'The deletion request failed. Please try again.'),
  };
}

export interface SubmissionLock {
  current: boolean;
}

export type SubmissionResult<T> =
  | { accepted: true; value: T }
  | { accepted: false };

export async function runSingleSubmission<T>(
  lock: SubmissionLock,
  submission: () => Promise<T>,
): Promise<SubmissionResult<T>> {
  if (lock.current) return { accepted: false };

  lock.current = true;
  try {
    return { accepted: true, value: await submission() };
  } finally {
    lock.current = false;
  }
}
