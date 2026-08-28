const sessionImages = new Map<string, Blob>();
let activeUserId: string | null = null;

export const ImageSessionStore = {
  setActiveUser(userId: string | null) {
    if (activeUserId !== userId) {
      sessionImages.clear();
      activeUserId = userId;
    }
  },
  setForUser(userId: string, receiptId: string, image: Blob) {
    if (activeUserId !== userId) return;
    sessionImages.set(receiptId, image);
  },
  getForUser(userId: string, receiptId: string): Blob | undefined {
    return activeUserId === userId ? sessionImages.get(receiptId) : undefined;
  },
  deleteForUser(userId: string, receiptId: string) {
    if (activeUserId === userId) sessionImages.delete(receiptId);
  },
  clearForUser(userId: string) {
    if (activeUserId === userId) sessionImages.clear();
  },
  getActiveUserId() {
    return activeUserId;
  }
};
