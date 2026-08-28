import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut as firebaseSignOut,
  signInWithRedirect,
  getRedirectResult
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
  getIdToken: () => Promise<string>;
}

interface AuthContextType {
  user: AuthenticatedUser | null;
  loading: boolean;
  signIn: () => Promise<void>;
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
          } catch (err) {
            console.error('Failed to initialize user profile on redirect', err);
            showToast("We couldn't set up your account profile. Please try refreshing.", 'error');
          }
        }
      })
      .catch((err: unknown) => {
        console.error('Redirect auth error:', err);
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
        } catch (err) {
          console.error("Failed to initialize user profile", err);
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
      console.warn('Popup sign in failed, falling back to redirect:', err);
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

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, error }}>
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
