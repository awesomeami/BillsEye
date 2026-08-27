const sessionImages = new Map<string, Blob>();

export const ImageSessionStore = {
  set(receiptId: string, image: Blob) {
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
  }
};
