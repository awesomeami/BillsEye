import React, { useState, useEffect } from 'react';
import { WifiOff, CloudOff, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../../utilities/cn';

export function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncState, setSyncState] = useState<'synced' | 'syncing' | 'error' | 'offline'>('synced');

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setSyncState('syncing');
      // Assume it syncs after a delay if online
      setTimeout(() => setSyncState('synced'), 2000);
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      setSyncState('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial state
    if (!navigator.onLine) {
      setSyncState('offline');
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (syncState === 'synced') return null;

  return (
    <div className={cn(
      "fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full shadow-md text-sm font-medium flex items-center gap-2 transition-all duration-300",
      syncState === 'offline' ? "bg-gray-800 text-white" :
      syncState === 'syncing' ? "bg-blue-100 text-blue-800" :
      "bg-red-100 text-red-800"
    )}>
      {syncState === 'offline' && <><WifiOff size={16} /> Offline Mode - Read Only</>}
      {syncState === 'syncing' && <><div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /> Syncing changes...</>}
      {syncState === 'error' && <><AlertCircle size={16} /> Sync Error</>}
    </div>
  );
}
