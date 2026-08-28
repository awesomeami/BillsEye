import React from 'react';
import { WifiOff, CloudOff, AlertCircle } from 'lucide-react';
import { cn } from '../../utilities/cn';
import { useReceiptsLibrary } from '../../features/receipts/library/ReceiptsLibraryContext';

export function NetworkStatus() {
  const { syncState } = useReceiptsLibrary();

  if (syncState === 'synced') return null;

  return (
    <div className={cn(
      "fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full shadow-md text-sm font-medium flex items-center gap-2 transition-all duration-300",
      syncState === 'offline' ? "bg-gray-800 text-white" :
      syncState === 'syncing' ? "bg-blue-100 text-blue-800" :
      syncState === 'pending-writes' ? "bg-amber-100 text-amber-900" :
      "bg-red-100 text-red-800"
    )} role="status" aria-live="polite">
      {syncState === 'offline' && <><WifiOff size={16} /> Offline — local changes will sync when you reconnect.</>}
      {syncState === 'pending-writes' && <><CloudOff size={16} /> Changes are saved locally and waiting to sync.</>}
      {syncState === 'syncing' && <><div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /> Synchronizing with the cloud…</>}
      {syncState === 'error' && <><AlertCircle size={16} /> Sync needs attention.</>}
    </div>
  );
}
