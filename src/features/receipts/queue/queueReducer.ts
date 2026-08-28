import type { QueueExtractionResult } from './queueProcessor';

export type QueueItemStatus = 
  | 'queued'
  | 'preprocessing'
  | 'duplicate-check'
  | 'extracting'
  | 'needs-review'
  | 'retry-wait'
  | 'failed-permanent'
  | 'cancelled'
  | 'duplicate';

export const isTerminalQueueStatus = (status: QueueItemStatus) =>
  ['needs-review', 'failed-permanent', 'cancelled', 'duplicate'].includes(status);

export const isRetryableQueueStatus = (status: QueueItemStatus) =>
  status === 'retry-wait' || status === 'failed-permanent';

export interface QueueItem {
  id: string;
  file: Blob; // Original File or rendered PDF page Blob or preprocessed Blob
  sourcePdf?: File; // Only if this is a PDF page
  pageNumber?: number; // Only if this is a PDF page
  originalName: string;
  mimeType: string;
  status: QueueItemStatus;
  extractionResult?: QueueExtractionResult;
  error?: string;
  retryAfter?: number;
  sha256?: string;
  objectUrl?: string; // transient url for preview
  receiptId?: string; // created in firestore
  progress?: number;
  abortController: AbortController;
  attempts: Array<{ timestamp: number, error?: string }>;
}

export type QueueAction = 
  | { type: 'ADD_ITEMS'; items: QueueItem[] }
  | { type: 'START_ATTEMPT'; id: string; timestamp: number }
  | { type: 'UPDATE_ITEM'; id: string; updates: Partial<QueueItem> }
  | { type: 'REMOVE_ITEM'; id: string }
  | { type: 'CANCEL_ITEM'; id: string }
  | { type: 'RETRY_ITEM'; id: string }
  | { type: 'CLEAR_QUEUE' };

export const queueReducer = (state: QueueItem[], action: QueueAction): QueueItem[] => {
  switch (action.type) {
    case 'ADD_ITEMS':
      return [...state, ...action.items];

    case 'START_ATTEMPT':
      return state.map(item =>
        item.id === action.id && item.status === 'queued'
          ? {
              ...item,
              status: 'preprocessing',
              attempts: [...item.attempts, { timestamp: action.timestamp }]
            }
          : item
      );
      
    case 'UPDATE_ITEM':
      return state.map(item => 
        item.id === action.id 
          ? { ...item, ...action.updates } 
          : item
      );
      
    case 'REMOVE_ITEM':
      return state.filter(i => i.id !== action.id);
      
    case 'CANCEL_ITEM':
      return state.map(item =>
        item.id === action.id && !isTerminalQueueStatus(item.status)
          ? { ...item, status: 'cancelled' }
          : item
      );
      
    case 'RETRY_ITEM':
      return state.map(item =>
        item.id === action.id && isRetryableQueueStatus(item.status)
          ? { 
              ...item, 
              status: 'queued', 
              error: undefined, 
              retryAfter: undefined,
              abortController: new AbortController() // fresh controller for new attempt
            }
          : item
      );

    case 'CLEAR_QUEUE':
      return [];
      
    default:
      return state;
  }
};
