import type { QueueItemStatus } from '../receipts/queue/queueReducer';

export interface QueueUpdateReadinessItem {
  status: QueueItemStatus;
}

export function hasMemoryOnlyQueueWork(items: QueueUpdateReadinessItem[]): boolean {
  return items.some(item => item.status !== 'duplicate' && item.status !== 'cancelled');
}

export function canApplyPwaUpdate(editorIsDirty: boolean, queueItems: QueueUpdateReadinessItem[]): boolean {
  return !editorIsDirty && !hasMemoryOnlyQueueWork(queueItems);
}

export function getPwaUpdateDeferralReason(editorIsDirty: boolean, queueItems: QueueUpdateReadinessItem[]): string | null {
  if (editorIsDirty) return 'Finish or discard your receipt edits before updating.';
  if (hasMemoryOnlyQueueWork(queueItems)) return 'Finish, cancel, or dismiss queued receipt processing before updating.';
  return null;
}
