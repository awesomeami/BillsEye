export type ReceiptStatus = 'pending_review' | 'confirmed' | 'rejected';

export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  total: number;
  category?: string;
}

export interface Receipt {
  id: string;
  userId: string;
  merchantName: string;
  merchantAddress?: string;
  date: string;
  totalAmount: number;
  taxAmount?: number;
  currency: string;
  items: ReceiptItem[];
  status: ReceiptStatus;
  category?: string;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string;
  preferences: {
    currency: string;
    locale: string;
    timeZone: string;
  };
}
