import { useEffect, useRef } from 'react';
import { ClientSessionActionGuard } from '../../services/firebase/subscriptionIsolation';
import { useAuth } from './AuthContext';

export function useClientSessionActionGuard(): ClientSessionActionGuard {
  const { user, sessionEpoch } = useAuth();
  const guardRef = useRef<ClientSessionActionGuard | null>(null);
  if (!guardRef.current) guardRef.current = new ClientSessionActionGuard();
  guardRef.current.update(user?.uid ?? null, sessionEpoch);

  useEffect(() => {
    const guard = guardRef.current;
    guard?.resume();
    return () => guard?.dispose();
  }, []);

  return guardRef.current;
}
