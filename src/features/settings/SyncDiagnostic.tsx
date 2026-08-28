import React, { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { db, firebaseConfig } from '../../services/firebase/config';
import { doc, setDoc, waitForPendingWrites, serverTimestamp, deleteDoc } from 'firebase/firestore';

export function SyncDiagnostic() {
  const { user } = useAuth();
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  
  const [statusAuth, setStatusAuth] = useState<string>('Pending');
  const [statusWrite, setStatusWrite] = useState<string>('Pending');
  const [statusAck, setStatusAck] = useState<string>('Pending');
  const [statusRead, setStatusRead] = useState<string>('Pending');
  const [statusCleanup, setStatusCleanup] = useState<string>('Pending');

  const [lastError, setLastError] = useState<string>('None');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (user) setStatusAuth('OK');
    else setStatusAuth('Not authenticated');
  }, [user]);

  const runSyncTest = async () => {
    if (!user) return;
    setTesting(true);
    setLastError('None');
    
    setStatusAuth('OK');
    setStatusWrite('Running...');
    setStatusAck('Pending');
    setStatusRead('Pending');
    setStatusCleanup('Pending');
    
    let currentStep = 'Write';
    
    try {
      const testDocRef = doc(db, `users/${user.uid}/settings/sync-test`);
      
      // Attempt write
      await setDoc(testDocRef, {
        lastTest: serverTimestamp(),
        device: navigator.userAgent.substring(0, 50)
      });
      setStatusWrite('OK');
      
      currentStep = 'Ack';
      setStatusAck('Running...');
      // Wait for it to hit the server (not just local cache)
      await waitForPendingWrites(db);
      setStatusAck('OK');

      currentStep = 'Read';
      setStatusRead('Running...');
      // Read the document back from the server
      const { getDocFromServer } = await import('firebase/firestore');
      const docSnap = await getDocFromServer(testDocRef);
      if (!docSnap.exists()) {
        throw new Error('Document not found on server after write.');
      }
      setStatusRead('OK');
      
      currentStep = 'Cleanup';
      setStatusCleanup('Running...');
      // Cleanup
      await deleteDoc(testDocRef);
      await waitForPendingWrites(db);
      setStatusCleanup('OK');
      
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
      if (currentStep === 'Write') setStatusWrite('Failed');
      if (currentStep === 'Ack') setStatusAck('Failed');
      if (currentStep === 'Read') setStatusRead('Failed');
      if (currentStep === 'Cleanup') setStatusCleanup('Failed');
    } finally {
      setTesting(false);
    }
  };

  if (!user) return null;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 text-xs font-mono text-gray-700">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold uppercase tracking-wider text-gray-900">Sync Diagnostic</h3>
        <button 
          onClick={runSyncTest} 
          disabled={testing || !online}
          className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50"
        >
          {testing ? 'Testing...' : 'Test Sync'}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <div className="sm:col-span-2 truncate"><span className="font-semibold">Project:</span> {firebaseConfig.projectId}</div>
        <div className="sm:col-span-2 truncate"><span className="font-semibold">Database:</span> {firebaseConfig.firestoreDatabaseId}</div>
      </div>
      
      <div className="border-t border-gray-100 pt-2 space-y-1">
        <div className="flex justify-between"><span>Authentication:</span> <span className={statusAuth === 'OK' ? 'text-green-600' : ''}>{statusAuth}</span></div>
        <div className="flex justify-between"><span>Write submitted:</span> <span className={statusWrite === 'OK' ? 'text-green-600' : statusWrite === 'Failed' ? 'text-red-600' : ''}>{statusWrite}</span></div>
        <div className="flex justify-between"><span>Server acknowledgement:</span> <span className={statusAck === 'OK' ? 'text-green-600' : statusAck === 'Failed' ? 'text-red-600' : ''}>{statusAck}</span></div>
        <div className="flex justify-between"><span>getDocFromServer read:</span> <span className={statusRead === 'OK' ? 'text-green-600' : statusRead === 'Failed' ? 'text-red-600' : ''}>{statusRead}</span></div>
        <div className="flex justify-between"><span>Cleanup deletion:</span> <span className={statusCleanup === 'OK' ? 'text-green-600' : statusCleanup === 'Failed' ? 'text-red-600' : ''}>{statusCleanup}</span></div>
      </div>

      {lastError !== 'None' && (
        <div className="mt-2 pt-2 border-t border-red-100 text-red-600 break-words">
          <span className="font-semibold">Error:</span> {lastError}
        </div>
      )}
    </div>
  );
}
