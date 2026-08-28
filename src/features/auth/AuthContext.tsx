import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut as firebaseSignOut,
  signInWithRedirect,
  getRedirectResult,
  reauthenticateWithPopup,
} from 'firebase/auth';
import { auth, googleProvider } from '../../services/firebase/config';
import { userRepository } from '../../services/firebase/db';
import { useToast } from '../../components/ui/Toast';
import { ImageSessionStore } from '../../utils/imageSessionStore';

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
  signIn: () => Promise<void>;
  reauthenticateAndGetIdToken: () => Promise<string>;
  signOut: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const useE2eMocks = import.meta.env.VITE_E2E_MOCKS === 'true';
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (useE2eMocks) {
      ImageSessionStore.setActiveUser(null);
      setLoading(false);
      return () => ImageSessionStore.setActiveUser(null);
    }

    // Handle redirect result for mobile browsers
    getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user) {
          try {
            await userRepository.getOrCreateProfile(
              result.user.uid,
              result.user.email || '',
              result.user.displayName
            );
          } catch {
            console.error('Failed to initialize user profile after redirect.');
            showToast("We couldn't set up your account profile. Please try refreshing.", 'error');
          }
        }
      })
      .catch((err: unknown) => {
        console.error('Redirect authentication failed.');
        setError(getErrorMessage(err, 'Authentication failed.'));
        showToast('Authentication failed. Please try again.', 'error');
      });

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      // Session images are strictly in-memory and must never cross an auth boundary.
      ImageSessionStore.setActiveUser(currentUser?.uid ?? null);
      setUser(currentUser);
      
      if (currentUser) {
        try {
          await userRepository.getOrCreateProfile(
            currentUser.uid,
            currentUser.email || '',
            currentUser.displayName
          );
        } catch {
          console.error('Failed to initialize user profile.');
          showToast("We couldn't set up your account profile. Please try refreshing.", 'error');
        }
      }
      
      setLoading(false);
    });

    return () => {
      unsubscribe();
      ImageSessionStore.setActiveUser(null);
    };
  }, [showToast]);

  const signIn = async () => {
    if (useE2eMocks) {
      ImageSessionStore.setActiveUser(e2eUser.uid);
      setUser(e2eUser);
      return;
    }
    try {
      setError(null);
      // Attempt popup first
      const result = await signInWithPopup(auth, googleProvider);
      if (result.user) {
        await userRepository.getOrCreateProfile(
          result.user.uid,
          result.user.email || '',
          result.user.displayName
        );
      }
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
      ImageSessionStore.setActiveUser(null);
      setUser(null);
      return;
    }
    try {
      await firebaseSignOut(auth);
    } catch (err: unknown) {
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
    <AuthContext.Provider value={{ user, loading, signIn, reauthenticateAndGetIdToken, signOut, error }}>
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
