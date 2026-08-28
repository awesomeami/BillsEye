const sessionImages = new Map<string, Blob>();
let activeUserId: string | null = null;

export const ImageSessionStore = {
  setActiveUser(userId: string | null) {
    if (activeUserId !== userId) {
      sessionImages.clear();
      activeUserId = userId;
    }
  },
  set(receiptId: string, image: Blob) {
    if (!activeUserId) return;
    sessionImages.set(receiptId, image);
  },
  get(receiptId: string): Blob | undefined {
    return sessionImages.get(receiptId);
  },
  delete(receiptId: string) {
    sessionImages.delete(receiptId);
  },
  clear() {
    sessionImages.clear();
  },
  getActiveUserId() {
    return activeUserId;
  }
};
