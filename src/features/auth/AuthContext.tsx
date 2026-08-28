import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged, 
  signInWithPopup, 
  signOut as firebaseSignOut,
  signInWithRedirect,
  getRedirectResult,
  reauthenticateWithPopup,
} from 'firebase/auth';
import { auth, googleProvider } from '../../services/firebase/authConfig';
import { useToast } from '../../components/ui/Toast';
import { ImageSessionStore } from '../../utils/imageSessionStore';
import { isE2eMockMode } from '../../config/e2eMocks';

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}

interface AuthContextType {
  user: AuthenticatedUser | null;
  loading: boolean;
  sessionEpoch: number;
  signIn: () => Promise<void>;
  reauthenticateAndGetIdToken: () => Promise<string>;
  signOut: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const useE2eMocks = isE2eMockMode;
const e2eUser: AuthenticatedUser = {
  uid: 'e2e-user',
  email: 'e2e@example.test',
  displayName: 'E2E Test User',
  photoURL: null,
  getIdToken: async () => 'e2e-test-firebase-token',
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : null;
}

async function clearOfflineDataAfterSignOut(uid: string): Promise<void> {
  const [firestore, firebase, vaultModule, offlineStorage] = await Promise.all([
    import('firebase/firestore'),
    import('../../services/firebase/config'),
    import('../../services/ai/vault'),
    import('../../services/firebase/offlineStorage'),
  ]);
  const { clearIndexedDbPersistence, terminate } = firestore;
  const { db } = firebase;
  const { AiVault } = vaultModule;
  const { clearLegacyVaultRemnants, clearOfflineDeviceData } = offlineStorage;
  const vault = new AiVault(uid);
  await clearOfflineDeviceData({
    terminateFirestore: () => terminate(db),
    clearFirestorePersistence: () => clearIndexedDbPersistence(db),
    clearLocalVault: () => vault.clearAllForUser(),
    clearLegacyVaultRemnants,
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { showToast, clearToasts } = useToast();
  const mountedRef = useRef(false);
  const authGenerationRef = useRef(0);

  const beginAuthTransition = useCallback((nextUser: AuthenticatedUser | null) => {
    ImageSessionStore.setActiveUser(null);
    clearToasts();
    setUser(nextUser);
    setError(null);
    setLoading(true);
    setSessionEpoch(epoch => epoch + 1);
    ImageSessionStore.setActiveUser(nextUser?.uid ?? null);
    return ++authGenerationRef.current;
  }, [clearToasts]);

  useEffect(() => {
    mountedRef.current = true;
    if (useE2eMocks) {
      ImageSessionStore.setActiveUser(null);
      setLoading(false);
      return () => {
        mountedRef.current = false;
        authGenerationRef.current += 1;
        ImageSessionStore.setActiveUser(null);
      };
    }

    // Handle redirect result for mobile browsers
    getRedirectResult(auth)
      .then(() => undefined)
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        console.error('Redirect authentication failed.');
        setError(getErrorMessage(err, 'Authentication failed.'));
        showToast('Authentication failed. Please try again.', 'error');
      });

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      const generation = beginAuthTransition(currentUser);
      
      if (currentUser) {
        try {
          const { userRepository } = await import('../../services/firebase/db');
          await userRepository.getOrCreateProfile(
            currentUser.uid,
            currentUser.email || '',
            currentUser.displayName
          );
        } catch {
          if (!mountedRef.current || generation !== authGenerationRef.current) return;
          console.error('Failed to initialize user profile.');
          showToast("We couldn't set up your account profile. Please try refreshing.", 'error');
        }
      }
      
      if (mountedRef.current && generation === authGenerationRef.current) setLoading(false);
    });

    return () => {
      unsubscribe();
      mountedRef.current = false;
      authGenerationRef.current += 1;
      ImageSessionStore.setActiveUser(null);
    };
  }, [beginAuthTransition, showToast]);

  const signIn = async () => {
    if (useE2eMocks) {
      beginAuthTransition(e2eUser);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      // Attempt popup first
      await signInWithPopup(auth, googleProvider);
    } catch (err: unknown) {
      console.warn('Popup sign in was unavailable; evaluating redirect fallback.');
      const errorCode = getErrorCode(err);
      if (errorCode === 'auth/popup-blocked' || errorCode === 'auth/popup-closed-by-user') {
        try {
          // Fallback to redirect for mobile or strict popup blockers
          await signInWithRedirect(auth, googleProvider);
        } catch (redirectErr: unknown) {
          setError(getErrorMessage(redirectErr, 'Failed to sign in.'));
          showToast('Failed to sign in', 'error');
        }
      } else {
        const message = getErrorMessage(err, 'Failed to sign in.');
        setError(message);
        showToast(message, 'error');
      }
    }
  };

  const signOut = async () => {
    if (useE2eMocks) {
      beginAuthTransition(null);
      setLoading(false);
      return;
    }
    const signedOutUserId = auth.currentUser?.uid ?? user?.uid ?? null;
    const offlineStorage = await import('../../services/firebase/offlineStorage');
    const clearOfflineData = offlineStorage.shouldClearOfflineDataAfterSignOut(
      offlineStorage.getClearOfflineDataOnSignOutPreference(),
      signedOutUserId,
    );
    beginAuthTransition(null);
    try {
      await firebaseSignOut(auth);
      if (clearOfflineData && signedOutUserId) {
        try {
          await clearOfflineDataAfterSignOut(signedOutUserId);
          window.location.reload();
        } catch {
          // Do not say the device was cleared unless every cleanup step succeeded.
          console.error('Could not confirm local offline-data clearing after sign-out.');
          showToast('You signed out, but local offline-data clearing could not be confirmed. Use Settings to clear this device before sharing it.', 'error');
        }
      }
    } catch (err: unknown) {
      const currentUser = auth.currentUser;
      beginAuthTransition(currentUser);
      setLoading(false);
      setError(getErrorMessage(err, 'Failed to sign out.'));
      showToast('Failed to sign out', 'error');
    }
  };

  const reauthenticateAndGetIdToken = async (): Promise<string> => {
    if (useE2eMocks) return e2eUser.getIdToken(true);

    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Sign in again before continuing.');
    }

    const credential = await reauthenticateWithPopup(currentUser, googleProvider);
    if (credential.user.uid !== currentUser.uid || auth.currentUser?.uid !== currentUser.uid) {
      throw new Error('The signed-in account changed. Please try again.');
    }

    // Firebase preserves auth_time across silent refreshes. This refresh is
    // intentionally performed only after a real provider reauthentication.
    return currentUser.getIdToken(true);
  };

  return (
    <AuthContext.Provider value={{ user, loading, sessionEpoch, signIn, reauthenticateAndGetIdToken, signOut, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
