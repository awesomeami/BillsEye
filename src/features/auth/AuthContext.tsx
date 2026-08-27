import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut as firebaseSignOut,
  User,
  signInWithRedirect,
  getRedirectResult
} from 'firebase/auth';
import { auth, googleProvider } from '../../services/firebase/config';
import { userRepository } from '../../services/firebase/db';
import { useToast } from '../../components/ui/Toast';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
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
      .catch((err) => {
        console.error('Redirect auth error:', err);
        setError(err.message);
        showToast('Authentication failed. Please try again.', 'error');
      });

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
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
      
      if (!currentUser) {
        // Clear any in-memory sensitive state or object URLs here if they were hoisted to global state
      }
      
      setLoading(false);
    });

    return unsubscribe;
  }, [showToast]);

  const signIn = async () => {
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
    } catch (err: any) {
      console.warn('Popup sign in failed, falling back to redirect:', err);
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
        try {
          // Fallback to redirect for mobile or strict popup blockers
          await signInWithRedirect(auth, googleProvider);
        } catch (redirectErr: any) {
          setError(redirectErr.message);
          showToast('Failed to sign in', 'error');
        }
      } else {
        setError(err.message);
        showToast(err.message || 'Failed to sign in', 'error');
      }
    }
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
    } catch (err: any) {
      setError(err.message);
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
