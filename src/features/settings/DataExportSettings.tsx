import React, { useState } from 'react';
import { ChevronRight, Download, Upload, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { db } from '../../services/firebase/config';
import { collection, getDocs, doc, writeBatch, Timestamp } from 'firebase/firestore';
import { generateJSONBackup, validateBackup, BackupEnvelope } from '../../services/export/backup';
import { AiVault } from '../../services/ai/vault';
import { ReceiptDocument, CategoryDocument } from '../../domain/schema';

interface DataExportSettingsProps {
  onBack: () => void;
}

export function DataExportSettings({ onBack }: DataExportSettingsProps) {
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ message: string, action: () => void } | null>(null);

  const [restoreDryRun, setRestoreDryRun] = useState<{
    envelope: BackupEnvelope;
    newReceipts: number;
    overwriteReceipts: number;
    unchangedReceipts: number;
    newCategories: number;
    overwriteCategories: number;
    unchangedCategories: number;
  } | null>(null);

  const fetchAllData = async () => {
    if (!user) throw new Error('Not authenticated');
    const receiptsSnap = await getDocs(collection(db, `users/${user.uid}/receipts`));
    const categoriesSnap = await getDocs(collection(db, `users/${user.uid}/categories`));
    
    return {
      receipts: receiptsSnap.docs.map(d => d.data() as ReceiptDocument),
      categories: categoriesSnap.docs.map(d => d.data() as CategoryDocument)
    };
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
    } catch (e: any) {
      setError(e.message);
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
    } catch (e: any) {
      setError(e.message);
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
    } catch (e: any) {
      setError(e.message);
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
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExportJSON = async () => {
    try {
      setLoading(true);
      const { receipts, categories } = await fetchAllData();
      const json = generateJSONBackup(receipts, categories);
      downloadFile(new Blob([json]), 'kharchalens_backup.json', 'application/json');
      setSuccess('JSON Backup exported successfully.');
    } catch (e: any) {
      setError(e.message);
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
        const result = validateBackup(text);
        if (!result.isValid || !result.envelope) {
          setError(result.error || 'Invalid backup file.');
          return;
        }

        // Fetch user's existing data to compute dry-run diff
        const existingData = await fetchAllData();
        const existingReceiptMap = new Map(existingData.receipts.map(r => [r.id, r]));
        const existingCategoryMap = new Map(existingData.categories.map(c => [c.id, c]));

        let newReceipts = 0;
        let overwriteReceipts = 0;
        let unchangedReceipts = 0;
        for (const r of result.envelope.receipts) {
          const existing = existingReceiptMap.get(r.id);
          if (!existing) {
            newReceipts++;
          } else {
            overwriteReceipts++;
            // Check if functionally identical
            if (JSON.stringify(r) === JSON.stringify(existing)) {
              unchangedReceipts++;
            }
          }
        }

        let newCategories = 0;
        let overwriteCategories = 0;
        let unchangedCategories = 0;
        for (const c of result.envelope.categories) {
          const existing = existingCategoryMap.get(c.id);
          if (!existing) {
            newCategories++;
          } else {
            overwriteCategories++;
            if (JSON.stringify(c) === JSON.stringify(existing)) {
              unchangedCategories++;
            }
          }
        }

        setRestoreDryRun({
          envelope: result.envelope,
          newReceipts,
          overwriteReceipts,
          unchangedReceipts,
          newCategories,
          overwriteCategories,
          unchangedCategories
        });
      } catch (err: any) {
        setError(err.message);
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
      const { receipts, categories } = restoreDryRun.envelope;
      
      let currentBatch = writeBatch(db);
      let count = 0;
      const MAX_BATCH = 500;

      const commitBatch = async () => {
        if (count > 0) {
          await currentBatch.commit();
          currentBatch = writeBatch(db);
          count = 0;
        }
      };

      for (const r of receipts) {
        const ref = doc(db, `users/${user.uid}/receipts`, r.id);
        const restoredReceipt = {
          ...r,
          createdAt: r.createdAt ? Timestamp.fromDate(new Date(r.createdAt)) : Timestamp.now(),
          updatedAt: r.updatedAt ? Timestamp.fromDate(new Date(r.updatedAt)) : Timestamp.now(),
          confirmedAt: r.confirmedAt ? Timestamp.fromDate(new Date(r.confirmedAt)) : null,
        };
        currentBatch.set(ref, restoredReceipt);
        count++;
        if (count === MAX_BATCH) await commitBatch();
      }

      for (const c of categories) {
        const ref = doc(db, `users/${user.uid}/categories`, c.id);
        currentBatch.set(ref, c);
        count++;
        if (count === MAX_BATCH) await commitBatch();
      }
      
      await commitBatch();

      setSuccess('Restore completed successfully.');
      setRestoreDryRun(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteData = () => {
    setConfirmAction({
      message: "Are you sure you want to delete ALL your receipt data? This action cannot be undone.",
      action: async () => {
        try {
      setLoading(true);
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await user?.getIdToken())}`
        },
        body: JSON.stringify({ action: 'delete_data' })
      });
      if (!res.ok) throw new Error('Failed to delete data');
      setSuccess('All data deleted successfully.');
        } catch (e: any) {
          setError(e.message);
        } finally {
          setLoading(false);
        }
      }
    });
  };
  const handleDeleteAccount = () => {
    setConfirmAction({
      message: "Are you sure you want to delete your ACCOUNT and ALL DATA? This cannot be undone.",
      action: async () => {
        try {
      setLoading(true);
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await user?.getIdToken())}`
        },
        body: JSON.stringify({ action: 'delete_account' })
      });
      if (!res.ok) throw new Error('Failed to delete account');
      
      if (user?.uid) {
        const vault = new AiVault(user.uid);
        await vault.clearAllForUser();
      }

      await signOut(); // This will redirect to login automatically
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  
      }
    });
  };

  return (
    <div className="space-y-6">
      <header className="pb-4 border-b border-gray-200 flex items-center gap-4">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500">
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

      {/* Export Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
        <h3 className="font-bold text-gray-900">Export Options</h3>
        <p className="text-sm text-gray-500">Download your data in various formats for personal analysis.</p>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={handleExportCSV} disabled={loading} className="btn-outline flex items-center justify-center gap-2 py-2">
            <Download size={16} /> Receipts CSV
          </button>
          <button onClick={handleExportItemsCSV} disabled={loading} className="btn-outline flex items-center justify-center gap-2 py-2">
            <Download size={16} /> Items CSV
          </button>
          <button onClick={handleExportExcel} disabled={loading} className="btn-outline flex items-center justify-center gap-2 py-2">
            <Download size={16} /> Excel Workbook
          </button>
          <button onClick={handleExportPDF} disabled={loading} className="btn-outline flex items-center justify-center gap-2 py-2">
            <Download size={16} /> PDF Report
          </button>
        </div>
      </div>

      {/* Backup Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
        <h3 className="font-bold text-gray-900">Backup & Restore</h3>
        <p className="text-sm text-gray-500">Create a secure JSON backup of your entire account or restore from a previous backup. Note: We do not use managed Firestore backups; JSON export is your personal backup method.</p>
        
        <div className="flex flex-col sm:flex-row gap-3">
          <button onClick={handleExportJSON} disabled={loading} className="btn-primary flex-1 flex items-center justify-center gap-2">
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
                <strong>Receipts:</strong> {restoreDryRun.newReceipts} new, {restoreDryRun.overwriteReceipts} will overwrite existing data ({restoreDryRun.envelope.receipts.length} total in file)
              </li>
              <li>
                <strong>Categories:</strong> {restoreDryRun.newCategories} new, {restoreDryRun.overwriteCategories} will overwrite existing data ({restoreDryRun.envelope.categories.length} total in file)
              </li>
              <li><strong>Schema Version:</strong> {restoreDryRun.envelope.version}</li>
            </ul>
            {restoreDryRun.overwriteReceipts > 0 || restoreDryRun.overwriteCategories > 0 ? (
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 p-3 rounded-lg border border-amber-200 mt-3 mb-4">
                <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Overwrite Warning:</strong> {restoreDryRun.overwriteReceipts} receipt(s) and {restoreDryRun.overwriteCategories} category(ies) in this backup match existing IDs and will overwrite your current data.
                </span>
              </div>
            ) : (
              <p className="text-xs text-blue-700 mt-2 mb-4">
                All records in this backup are new. No existing data will be overwritten.
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={confirmRestore} disabled={loading} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
                {loading && <Loader2 size={16} className="animate-spin" />}
                Confirm Restore
              </button>
              <button onClick={() => setRestoreDryRun(null)} disabled={loading} className="bg-white text-gray-700 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50">
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
        <p className="text-sm text-red-600/80">These actions are irreversible. Please proceed with caution.</p>
        
        <div className="space-y-3">
          <button 
            onClick={handleDeleteData} 
            disabled={loading} 
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-white border border-red-200 text-red-600 rounded-xl shadow-sm font-medium hover:bg-red-100 transition-colors"
          >
            <Trash2 size={18} /> Delete All My Receipt Data
          </button>
          
          <button 
            onClick={handleDeleteAccount} 
            disabled={loading} 
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-red-600 text-white rounded-xl shadow-sm font-medium hover:bg-red-700 transition-colors"
          >
            <Trash2 size={18} /> Delete My Account
          </button>
        </div>
      </div>
    </div>
  );
}
