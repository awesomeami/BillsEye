import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache } from 'firebase/firestore';
import { getTrustedDevicePreference } from './offlineStorage';
import { app, firebaseConfig } from './authConfig';

export { firebaseConfig } from './authConfig';

// This preference is read exactly once when Firestore is initialized. Switching
// persistence mode therefore requires terminating the current client and a
// reload; Settings makes that explicit before saving a new preference.
export const isTrustedDevice = getTrustedDevicePreference();

export const db = initializeFirestore(app, {
  localCache: isTrustedDevice 
    ? persistentLocalCache({ tabManager: persistentMultipleTabManager() }) 
    : memoryLocalCache()
}, firebaseConfig.firestoreDatabaseId);


