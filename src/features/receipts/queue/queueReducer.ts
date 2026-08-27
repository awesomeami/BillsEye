export type QueueItemStatus = 
  | 'queued'
  | 'preprocessing'
  | 'duplicate-check'
  | 'extracting'
  | 'needs-review'
  | 'retry-wait'
  | 'failed-permanent'
  | 'cancelled'
  | 'duplicate'
  | 'completed';

export interface QueueItem {
  id: string;
  file: Blob; // Original File or rendered PDF page Blob or preprocessed Blob
  sourcePdf?: File; // Only if this is a PDF page
  pageNumber?: number; // Only if this is a PDF page
  originalName: string;
  mimeType: string;
  status: QueueItemStatus;
  extractionResult?: any;
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
  | { type: 'UPDATE_ITEM'; id: string; updates: Partial<QueueItem> }
  | { type: 'REMOVE_ITEM'; id: string }
  | { type: 'CANCEL_ITEM'; id: string }
  | { type: 'RETRY_ITEM'; id: string };

export const queueReducer = (state: QueueItem[], action: QueueAction): QueueItem[] => {
  switch (action.type) {
    case 'ADD_ITEMS':
      return [...state, ...action.items];
      
    case 'UPDATE_ITEM':
      return state.map(item => 
        item.id === action.id 
          ? { ...item, ...action.updates } 
          : item
      );
      
    case 'REMOVE_ITEM': {
      const itemToRemove = state.find(i => i.id === action.id);
      if (itemToRemove) {
        itemToRemove.abortController.abort();
        if (itemToRemove.objectUrl) URL.revokeObjectURL(itemToRemove.objectUrl);
      }
      return state.filter(i => i.id !== action.id);
    }
      
    case 'CANCEL_ITEM': {
      const itemToCancel = state.find(i => i.id === action.id);
      if (itemToCancel) {
        itemToCancel.abortController.abort();
      }
      return state.map(item =>
        item.id === action.id
          ? { ...item, status: 'cancelled' }
          : item
      );
    }
      
    case 'RETRY_ITEM':
      return state.map(item =>
        item.id === action.id && (item.status === 'retry-wait' || item.status === 'failed-permanent')
          ? { 
              ...item, 
              status: 'queued', 
              error: undefined, 
              retryAfter: undefined,
              abortController: new AbortController() // fresh controller for new attempt
            }
          : item
      );
      
    default:
      return state;
  }
};
