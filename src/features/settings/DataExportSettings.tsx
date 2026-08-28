import React, { useReducer, useRef, useState } from 'react';
import { ChevronRight, Download, Upload, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { db } from '../../services/firebase/config';
import { collection, getDoc, getDocs, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  generateJSONBackup,
  normalizeBackupContents,
  receiptRestorePatch,
  summarizeRestoreRecords,
  validateBackup,
  BackupEnvelope,
} from '../../services/export/backup';
import { useAiKeys } from './ai/AiKeysContext';
import { receiptRepository, aliasRepository, settingsRepository } from '../../services/firebase/db';
import {
  accountDeletionUiReducer,
  confirmationForAccountDeletion,
  initialAccountDeletionUiState,
  performAccountDeletion,
  runSingleSubmission,
} from './accountDeletionFlow';

interface DataExportSettingsProps {
  onBack: () => void;
}

const toIsoTimestamp = (value: unknown): string => {
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  throw new Error('Backup contains an invalid timestamp.');
};

const messageForError = (error: unknown): string => error instanceof Error ? error.message : 'An unexpected error occurred.';

export function DataExportSettings({ onBack }: DataExportSettingsProps) {
  const { user, reauthenticateAndGetIdToken, signOut } = useAuth();
  const { clearLocalVault } = useAiKeys();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deletionUi, dispatchDeletionUi] = useReducer(
    accountDeletionUiReducer,
    initialAccountDeletionUiState,
  );
  const deletionSubmissionLock = useRef(false);

  const [restoreDryRun, setRestoreDryRun] = useState<{
    envelope: BackupEnvelope;
    records: Record<'profile' | 'receipts' | 'categories' | 'aliases' | 'settings', {
      new: number;
      overwritten: number;
      unchanged: number;
    }>;
  } | null>(null);

  const fetchAllData = async () => {
    if (!user) throw new Error('Not authenticated');
    const [receipts, categoriesSnap, aliases, settings, profileSnap] = await Promise.all([
      receiptRepository.getReceipts(user.uid),
      getDocs(collection(db, `users/${user.uid}/categories`)),
      aliasRepository.getAliases(user.uid),
      settingsRepository.getSettings(user.uid),
      getDoc(doc(db, 'users', user.uid)),
    ]);

    return normalizeBackupContents({
      profile: profileSnap.exists() ? profileSnap.data() : null,
      receipts,
      categories: categoriesSnap.docs.map(category => category.data()),
      aliases,
      settings,
    });
  };

  const downloadFile = (blob: Blob | ArrayBuffer, filename: string, type: string) => {
    const finalBlob = blob instanceof Blob ? blob : new Blob([blob], { type });
    const url = URL.createObjectURL(finalBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = async () => {
    try {
      setLoading(true);
      const { receipts } = await fetchAllData();
      const { exportReceiptsCSV } = await import('../../services/export/csv');
      const csv = exportReceiptsCSV(receipts);
      downloadFile(new Blob([csv]), 'receipts.csv', 'text/csv;charset=utf-8;');
      setSuccess('CSV exported successfully.');
    } catch (error) {
      setError(messageForError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleExportItemsCSV = async () => {
    try {
      setLoading(true);
      const { receipts } = await fetchAllData();
      const { exportItemsCSV } = await import('../../services/export/csv');
      const csv = exportItemsCSV(receipts);
      downloadFile(new Blob([csv]), 'items.csv', 'text/csv;charset=utf-8;');
      setSuccess('Items CSV exported successfully.');
    } catch (error) {
      setError(messageForError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = async () => {
    try {
      setLoading(true);
      const { receipts, categories } = await fetchAllData();
      const { exportExcel } = await import('../../services/export/excel');
      const buffer = await exportExcel(receipts, categories);
      downloadFile(buffer, 'kharchalens_export.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      setSuccess('Excel exported successfully.');
    } catch (error) {
      setError(messageForError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleExportPDF = async () => {
    try {
      setLoading(true);
      const { receipts } = await fetchAllData();
      const { exportPDF } = await import('../../services/export/pdf');
      const buffer = exportPDF(receipts, 'All Time');
      downloadFile(buffer, 'report.pdf', 'application/pdf');
      setSuccess('PDF exported successfully.');
    } catch (error) {
      setError(messageForError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleExportJSON = async () => {
    try {
      setLoading(true);
      const json = await generateJSONBackup(await fetchAllData());
      downloadFile(new Blob([json]), 'kharchalens_backup.json', 'application/json');
      setSuccess('JSON Backup exported successfully.');
    } catch (error) {
      setError(messageForError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        setLoading(true);
        setError('');
        const text = event.target?.result as string;
        const result = await validateBackup(text);
        if (!result.isValid || !result.envelope) {
          setError(result.error || 'Invalid backup file.');
          return;
        }

        // Fetch user's existing data to compute dry-run diff
        const existingData = await fetchAllData();
        const profileUnchanged = JSON.stringify(result.envelope.profile) === JSON.stringify(existingData.profile);

        setRestoreDryRun({
          envelope: result.envelope,
          records: {
            profile: result.envelope.profile === null
              ? { new: 0, overwritten: 0, unchanged: 0 }
              : existingData.profile === null
                ? { new: 1, overwritten: 0, unchanged: 0 }
                : { new: 0, overwritten: profileUnchanged ? 0 : 1, unchanged: profileUnchanged ? 1 : 0 },
            receipts: summarizeRestoreRecords(result.envelope.receipts, existingData.receipts),
            categories: summarizeRestoreRecords(result.envelope.categories, existingData.categories),
            aliases: summarizeRestoreRecords(result.envelope.aliases, existingData.aliases),
            settings: result.envelope.settings === null
              ? { new: 0, overwritten: 0, unchanged: 0 }
              : existingData.settings === null
                ? { new: 1, overwritten: 0, unchanged: 0 }
                : JSON.stringify(result.envelope.settings) === JSON.stringify(existingData.settings)
                  ? { new: 0, overwritten: 0, unchanged: 1 }
                  : { new: 0, overwritten: 1, unchanged: 0 },
          },
        });
      } catch (error) {
        setError(messageForError(error));
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  const confirmRestore = async () => {
    if (!restoreDryRun || !user) return;
    try {
      setLoading(true);
      const { profile, receipts, categories, aliases, settings } = restoreDryRun.envelope;
      
      for (const r of receipts) {
        const existing = await receiptRepository.getReceipt(user.uid, r.id);
        if (existing) {
          if (JSON.stringify(r) !== JSON.stringify(existing)) {
            await receiptRepository.updateReceipt(user.uid, r.id, receiptRestorePatch(r), existing.revision);
          }
        } else {
          await receiptRepository.createReceipt(user.uid, r, { preserveTimestamps: true });
        }
      }

      for (const c of categories) {
        const ref = doc(db, `users/${user.uid}/categories`, c.id);
        const existing = await getDoc(ref);
        await setDoc(ref, {
          ...c,
          createdAt: existing.exists() ? toIsoTimestamp(existing.data().createdAt) : toIsoTimestamp(c.createdAt),
        });
      }

      for (const alias of aliases) {
        const ref = doc(db, `users/${user.uid}/aliases`, alias.id);
        const existing = await getDoc(ref);
        await setDoc(ref, {
          ...alias,
          createdAt: existing.exists() ? toIsoTimestamp(existing.data().createdAt) : toIsoTimestamp(alias.createdAt),
          updatedAt: existing.exists() ? new Date().toISOString() : toIsoTimestamp(alias.updatedAt),
        });
      }

      if (settings) {
        await setDoc(doc(db, `users/${user.uid}/settings/default`), settings);
      }

      if (profile) {
        const profileRef = doc(db, 'users', user.uid);
        const existingProfile = await getDoc(profileRef);
        if (existingProfile.exists()) {
          await setDoc(profileRef, {
            displayName: profile.displayName ?? null,
            schemaVersion: Math.max(Number(existingProfile.data().schemaVersion) || 1, profile.schemaVersion),
            lastLoginAt: serverTimestamp(),
          }, { merge: true });
        } else if (user.email) {
          const profileWrite: Record<string, unknown> = {
            email: user.email,
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
            schemaVersion: profile.schemaVersion,
          };
          if (profile.displayName !== undefined) profileWrite.displayName = profile.displayName;
          await setDoc(profileRef, profileWrite);
        }
      }

      setSuccess('Restore completed successfully. Existing receipt updates received a new revision.');
      setRestoreDryRun(null);
    } catch (error) {
      setError(messageForError(error));
    } finally {
      setLoading(false);
    }
  };

  const openDeletionConfirmation = (action: 'delete_data' | 'delete_account') => {
    if (loading || deletionSubmissionLock.current) return;
    setError('');
    setSuccess('');
    dispatchDeletionUi({
      type: 'open-confirmation',
      confirmation: confirmationForAccountDeletion(action),
    });
  };

  const confirmDeletion = () => {
    const action = deletionUi.confirmation?.action;
    if (!action) return;

    void runSingleSubmission(deletionSubmissionLock, async () => {
      dispatchDeletionUi({ type: 'submission-started', action });
      let outcome = await performAccountDeletion(action, {
        reauthenticateAndGetIdToken,
        fetch,
      });

      if (action === 'delete_account' && outcome.status === 'success') {
        try {
          await clearLocalVault();
          showToast('Your account and local Gemini vault were deleted.', 'success');
        } catch {
          // Signing out still clears in-memory key material through AiKeysProvider.
          outcome = {
            status: 'partial-failure',
            action,
            progress: null,
            message: 'The account was deleted, but local Gemini vault cleanup could not finish. Clear this device\'s offline data before using it again.',
          };
          showToast(outcome.message, 'error');
        }

        dispatchDeletionUi({ type: 'submission-finished', outcome });
        await signOut();
        return outcome;
      }

      dispatchDeletionUi({ type: 'submission-finished', outcome });
      return outcome;
    });
  };

  const deletionPending = deletionUi.outcome.status === 'pending';
  const pendingDeletionAction = deletionUi.outcome.status === 'pending'
    ? deletionUi.outcome.action
    : null;

  return (
    <div className="space-y-6">
      <header className="pb-4 border-b border-gray-200 flex items-center gap-4">
        <button onClick={onBack} aria-label="Back to settings" className="touch-target p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500">
          <ChevronRight className="rotate-180" size={20} />
        </button>
        <h2 className="text-xl font-bold text-gray-900">Data & Exports</h2>
      </header>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl text-sm border border-red-100">
          {error}
        </div>
      )}
      
      {success && (
        <div className="bg-green-50 text-green-700 p-4 rounded-xl text-sm border border-green-100">
          {success}
        </div>
      )}

      {deletionUi.outcome.status !== 'idle' && (
        <div
          role={deletionUi.outcome.status === 'pending' || deletionUi.outcome.status === 'success' ? 'status' : 'alert'}
          aria-live={deletionUi.outcome.status === 'pending' ? 'polite' : 'assertive'}
          className={`p-4 rounded-xl text-sm border flex items-start gap-2 ${
            deletionUi.outcome.status === 'success'
              ? 'bg-green-50 text-green-700 border-green-100'
              : deletionUi.outcome.status === 'pending'
                ? 'bg-blue-50 text-blue-700 border-blue-100'
                : deletionUi.outcome.status === 'reauthentication-required'
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-red-50 text-red-700 border-red-100'
          }`}
        >
          {deletionPending && <Loader2 size={16} className="animate-spin shrink-0 mt-0.5" aria-hidden="true" />}
          <span>{deletionUi.outcome.message}</span>
        </div>
      )}

      {/* Export Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
        <h3 className="font-bold text-gray-900">Export Options</h3>
        <p className="text-sm text-gray-500">Download your data in various formats for personal analysis.</p>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={handleExportCSV} disabled={loading} className="touch-target btn-outline flex items-center justify-center gap-2 py-2">
            <Download size={16} /> Receipts CSV
          </button>
          <button onClick={handleExportItemsCSV} disabled={loading} className="touch-target btn-outline flex items-center justify-center gap-2 py-2">
            <Download size={16} /> Items CSV
          </button>
          <button onClick={handleExportExcel} disabled={loading} className="touch-target btn-outline flex items-center justify-center gap-2 py-2">
            <Download size={16} /> Excel Workbook
          </button>
          <button onClick={handleExportPDF} disabled={loading} className="touch-target btn-outline flex items-center justify-center gap-2 py-2">
            <Download size={16} /> PDF Report
          </button>
        </div>
      </div>

      {/* Backup Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
        <h3 className="font-bold text-gray-900">Backup & Restore</h3>
        <p className="text-sm text-gray-500">JSON backups include your profile record, receipts, categories, aliases, and settings. They use a SHA-256 corruption check but are not encrypted or authenticated, so restore only a file you trust. Gemini keys and receipt images are never included.</p>
        
        <div className="flex flex-col sm:flex-row gap-3">
          <button onClick={handleExportJSON} disabled={loading} className="touch-target btn-primary flex-1 flex items-center justify-center gap-2">
            <Download size={16} /> Download JSON Backup
          </button>
          <label className="btn-outline flex-1 flex items-center justify-center gap-2 cursor-pointer">
            <Upload size={16} /> 
            <span>Select Backup to Restore</span>
            <input type="file" accept=".json" className="hidden" onChange={handleFileChange} disabled={loading} />
          </label>
        </div>

        {restoreDryRun && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-100 rounded-xl">
            <h4 className="font-bold text-blue-900 mb-2">Restore Preview</h4>
            <ul className="text-sm text-blue-800 space-y-1 list-disc pl-5">
              <li>
                <strong>Receipts:</strong> {restoreDryRun.records.receipts.new} new, {restoreDryRun.records.receipts.unchanged} unchanged, {restoreDryRun.records.receipts.overwritten} will overwrite
              </li>
              <li>
                <strong>Categories:</strong> {restoreDryRun.records.categories.new} new, {restoreDryRun.records.categories.unchanged} unchanged, {restoreDryRun.records.categories.overwritten} will overwrite
              </li>
              <li><strong>Aliases:</strong> {restoreDryRun.records.aliases.new} new, {restoreDryRun.records.aliases.unchanged} unchanged, {restoreDryRun.records.aliases.overwritten} will overwrite</li>
              <li><strong>Settings:</strong> {restoreDryRun.records.settings.new} new, {restoreDryRun.records.settings.unchanged} unchanged, {restoreDryRun.records.settings.overwritten} will overwrite</li>
              <li><strong>Profile:</strong> {restoreDryRun.records.profile.new} new, {restoreDryRun.records.profile.unchanged} unchanged, {restoreDryRun.records.profile.overwritten} display name update</li>
              <li><strong>Schema Version:</strong> {restoreDryRun.envelope.version}</li>
            </ul>
            {(restoreDryRun.records.receipts.overwritten + restoreDryRun.records.categories.overwritten + restoreDryRun.records.aliases.overwritten + restoreDryRun.records.settings.overwritten + restoreDryRun.records.profile.overwritten) > 0 ? (
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 p-3 rounded-lg border border-amber-200 mt-3 mb-4">
                <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Conflict policy:</strong> backup fields replace records with matching IDs. Existing receipts keep their creation time and receive a new revision and current update time, so Firestore revision protection remains in effect. The signed-in account’s email and profile creation time are never replaced.
                </span>
              </div>
            ) : (
              <p className="text-xs text-blue-700 mt-2 mb-4">
                All records in this backup are new. No existing data will be overwritten.
              </p>
            )}
            <p className="text-xs text-blue-700 mt-2 mb-4">A profile restore preserves the signed-in account’s email and creation time; it can restore the display name and profile schema version only.</p>
            <p className="text-xs text-blue-700 mt-2 mb-4">The backup is fully validated before restore starts. Firestore writes are applied record by record; if a network failure interrupts it, retry the same backup to complete the remaining records.</p>
            <div className="flex gap-2">
              <button onClick={confirmRestore} disabled={loading} className="touch-target bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
                {loading && <Loader2 size={16} className="animate-spin" />}
                Confirm Restore
              </button>
              <button onClick={() => setRestoreDryRun(null)} disabled={loading} className="touch-target bg-white text-gray-700 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Danger Zone */}
      <div className="bg-red-50 rounded-2xl shadow-sm border border-red-200 p-6 space-y-4">
        <div className="flex items-center gap-2 text-red-700">
          <AlertTriangle size={20} />
          <h3 className="font-bold">Danger Zone</h3>
        </div>
        <p className="text-sm text-red-600/80">These actions are irreversible. Firestore cannot atomically delete multiple collections; if a deletion is interrupted, the app reports it so you can retry safely.</p>
        
        <div className="space-y-3">
          <button 
            onClick={() => openDeletionConfirmation('delete_data')}
            disabled={loading || deletionPending}
            className="touch-target w-full flex items-center justify-center gap-2 py-3 px-4 bg-white border border-red-200 text-red-700 rounded-xl shadow-sm font-medium hover:bg-red-100 transition-colors"
          >
            {pendingDeletionAction === 'delete_data'
              ? <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              : <Trash2 size={18} />}
            {pendingDeletionAction === 'delete_data'
              ? 'Deleting cloud data…'
              : 'Delete My Cloud Data (except Profile)'}
          </button>
          
          <button 
            onClick={() => openDeletionConfirmation('delete_account')}
            disabled={loading || deletionPending}
            className="touch-target w-full flex items-center justify-center gap-2 py-3 px-4 bg-red-600 text-white rounded-xl shadow-sm font-medium hover:bg-red-700 transition-colors"
          >
            {pendingDeletionAction === 'delete_account'
              ? <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              : <Trash2 size={18} />}
            {pendingDeletionAction === 'delete_account'
              ? 'Deleting account…'
              : 'Delete My Account'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={deletionUi.confirmation !== null}
        title={deletionUi.confirmation?.title ?? ''}
        message={deletionUi.confirmation?.message ?? ''}
        confirmText={deletionUi.confirmation?.confirmText ?? 'Delete'}
        isDestructive={true}
        onConfirm={confirmDeletion}
        onCancel={() => dispatchDeletionUi({ type: 'cancel-confirmation' })}
      />
    </div>
  );
}
