/**
 * The user-owned Firestore collections. Keep this manifest in sync whenever a
 * feature adds persistent account data so backup and deletion have the same
 * deliberate scope.
 */
export const USER_OWNED_SUBCOLLECTIONS = {
  receipts: { backup: true, nestedCollections: ['items'] },
  categories: { backup: true, nestedCollections: [] },
  aliases: { backup: true, nestedCollections: [] },
  settings: { backup: true, nestedCollections: [] },
} as const;

export type UserOwnedSubcollection = keyof typeof USER_OWNED_SUBCOLLECTIONS;

export const USER_OWNED_SUBCOLLECTION_NAMES = Object.keys(
  USER_OWNED_SUBCOLLECTIONS,
) as UserOwnedSubcollection[];
