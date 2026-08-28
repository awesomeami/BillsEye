import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useToast } from '../../components/ui/Toast';
import { useParams, useNavigate } from 'react-router-dom';
import { APP_CONFIG } from "../../utilities/config";
import { useAuth } from '../auth/AuthContext';
import { MAX_RECEIPT_ITEMS, ReceiptDocument } from '../../domain/schema';
import { ImageSessionStore } from '../../utils/imageSessionStore';
import { createSha256Hash, preprocessImage } from '../../utils/imageUtils';
import { aliasRepository, receiptRepository } from '../../services/firebase/db';
import { Upload, AlertTriangle, Check, ArrowLeft, Trash2, Plus } from 'lucide-react';
import { parseMajorToMinor } from '../../domain/money';
import { reconcileReceipt } from '../../domain/reconciliation';
import {
  applyMerchantCategoryAlias,
  canonicalizeReceiptItemCategories,
  resolveReceiptItemCategoryId,
} from '../../domain/categories';
import { useReceiptsLibrary } from './library/ReceiptsLibraryContext';
import { useClientSessionActionGuard } from '../auth/useClientSessionActionGuard';

type ReceiptItem = ReceiptDocument['items'][number];

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function minorToStr(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return (value / 100).toFixed(2);
}

function strToMinor(value: string): number | null {
  if (!value.trim()) return null;
  try {
    return parseMajorToMinor(value);
  } catch {
    return null; // fallback or could store error state
  }
}

export function ReviewReceiptScreen() {
  const { showToast } = useToast();
  const { id } = useParams();
  const { user } = useAuth();
  const sessionActions = useClientSessionActionGuard();
  const { categories, settings } = useReceiptsLibrary();
  const navigate = useNavigate();
  
  const [receipt, setReceipt] = useState<ReceiptDocument | null>(null);
  const [formData, setFormData] = useState<Partial<ReceiptDocument>>({});
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reattachError, setReattachError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<ReceiptDocument[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageUrlRef = useRef<string | null>(null);
  const activeReceiptIdRef = useRef<string | null>(id ?? null);
  activeReceiptIdRef.current = id ?? null;

  const clearImagePreview = useCallback(() => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    imageUrlRef.current = null;
    setImageUrl(null);
  }, []);

  const setImagePreview = useCallback((image: Blob) => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    const nextUrl = URL.createObjectURL(image);
    imageUrlRef.current = nextUrl;
    setImageUrl(nextUrl);
  }, []);

  useEffect(() => {
    let isCurrent = true;

    async function load() {
      if (!user || !id) {
        setLoading(false);
        return;
      }
      try {
        const data = await receiptRepository.getReceipt(user.uid, id);
        if (data) {
          if (!isCurrent) return;
          setReceipt(data);
          const canonicalItems = canonicalizeReceiptItemCategories(data.items, categories);
          const alias = data.merchantNormalized
            ? await aliasRepository.getAliasForMerchant(user.uid, data.merchantNormalized)
            : null;
          if (!isCurrent) return;
          setFormData({
            ...data,
            items: alias ? applyMerchantCategoryAlias(canonicalItems, alias.categoryId) : canonicalItems,
          });
          
          if (data.merchantNormalized && data.transactionDate && data.printedGrandTotal != null) {
            const possibleDups = await receiptRepository.findPossibleDuplicates(
              user.uid, 
              data.merchantNormalized, 
              data.transactionDate, 
              data.printedGrandTotal
            );
            if (isCurrent) setDuplicates(possibleDups.filter(d => d.id !== data.id));
          }

          const sessionImage = ImageSessionStore.getForUser(user.uid, id);
          if (isCurrent && sessionImage) setImagePreview(sessionImage);
        } else {
          if (isCurrent) setError('Receipt not found or cannot be reviewed safely.');
        }
      } catch (err: unknown) {
        if (isCurrent) setError(getErrorMessage(err, 'Could not load this receipt.'));
      } finally {
        if (isCurrent) setLoading(false);
      }
    }
    load();
    
    return () => {
      isCurrent = false;
      clearImagePreview();
    };
  }, [id, user, categories, clearImagePreview, setImagePreview]);

  const handleReattach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !receipt || !user) return;
    const scope = sessionActions.capture();
    if (!scope) return;
    const receiptId = receipt.id;
    const isActiveReceipt = () => sessionActions.isActive(scope) && activeReceiptIdRef.current === receiptId;
    setReattachError(null);
    try {
      const { blob: processedBlob } = await preprocessImage(file);
      if (!isActiveReceipt()) return;
      const hash = await createSha256Hash(processedBlob);
      if (!isActiveReceipt()) return;
      if (hash === receipt.sourceSha256) {
        ImageSessionStore.setForUser(scope.uid, receiptId, processedBlob);
        setImagePreview(processedBlob);
      } else {
        setReattachError('Hash mismatch. This is not the original file.');
      }
    } catch (err: unknown) {
      if (!isActiveReceipt()) return;
      setReattachError(getErrorMessage(err, 'Could not prepare the selected image.'));
    }
    if (isActiveReceipt() && e.target) e.target.value = '';
  };

  const updateField = <K extends keyof ReceiptDocument>(field: K, value: ReceiptDocument[K]) => {
    setFormData(prev => ({ ...prev, [field]: value, wasEditedByUser: true }));
  };

  const updateItem = <K extends keyof ReceiptItem>(index: number, field: K, value: ReceiptItem[K]) => {
    setFormData(prev => {
      const newItems = [...(prev.items || [])];
      if (field === 'categoryId') {
        const { category: _legacyCategory, ...withoutLegacyCategory } = newItems[index];
        newItems[index] = {
          ...withoutLegacyCategory,
          categoryId: typeof value === 'string' && value ? value : null,
          userEdited: true,
        };
      } else {
        newItems[index] = { ...newItems[index], [field]: value, userEdited: true };
      }
      return { ...prev, items: newItems, wasEditedByUser: true };
    });
  };

  const addItem = () => {
    if (currentItems.length >= MAX_RECEIPT_ITEMS) {
      showToast(`Receipts support up to ${MAX_RECEIPT_ITEMS} items. Remove an item before adding another.`, 'error');
      return;
    }
    setFormData(prev => ({
      ...prev,
      items: [...(prev.items || []), {
        id: crypto.randomUUID(),
        rawLineText: '',
        name: null,
        brand: null,
        quantity: 1,
        unit: null,
        unitPrice: null,
        discount: null,
        lineTotal: null,
        categoryId: null,
        confidence: 1,
        userEdited: true,
        warnings: []
      }],
      wasEditedByUser: true
    }));
  };

  const removeItem = (index: number) => {
    setFormData(prev => {
      const newItems = [...(prev.items || [])];
      newItems.splice(index, 1);
      return { ...prev, items: newItems, wasEditedByUser: true };
    });
  };

  const currentItems = formData.items || [];
  
  // Recalculate reconciliation continuously
  const reconciliation = reconcileReceipt(
    currentItems,
    {
      printedSubtotal: formData.printedSubtotal,
      printedDiscount: formData.printedDiscount,
      printedTax: formData.printedTax,
      printedFees: formData.printedFees,
      printedRounding: formData.printedRounding,
      printedGrandTotal: formData.printedGrandTotal,
    },
    settings.discrepancyTolerance,
  );

  const handleSave = async (status: 'confirmed' | 'pendingReview' = 'confirmed') => {
    if (!user || !receipt) return;
    const scope = sessionActions.capture();
    if (!scope) return;
    const receiptId = receipt.id;
    const isActiveReceipt = () => sessionActions.isActive(scope) && activeReceiptIdRef.current === receiptId;
    setIsSaving(true);

    if (APP_CONFIG.currency === 'PKR' && formData.currency !== 'PKR') {
      showToast("This app is configured for PKR only. Please resolve the currency to PKR before saving.", "error");
      setIsSaving(false);
      return;
    }

    try {
      const payload: Partial<ReceiptDocument> = {
        ...formData,
        items: canonicalizeReceiptItemCategories(formData.items || [], categories),
        status,
        confirmedAt: status === 'confirmed'
          ? receipt.confirmedAt || new Date().toISOString()
          : null,
        computedLineTotal: reconciliation.computedLineTotal,
        computedExpectedTotal: reconciliation.computedExpectedTotal,
        discrepancy: reconciliation.discrepancy,
        reconciliationStatus: reconciliation.reconciliationStatus,
      };
      if (payload.confirmedAt === undefined) {
        delete payload.confirmedAt;
      }

      await receiptRepository.updateReceipt(scope.uid, receiptId, payload, receipt.revision);
      if (!isActiveReceipt()) return;
      if (status === 'confirmed') {
        ImageSessionStore.deleteForUser(scope.uid, receiptId);
        clearImagePreview();
        navigate('/');
      } else {
        showToast("Saved successfully!", "success");
      }
    } catch (e: unknown) {
      if (!isActiveReceipt()) return;
      console.error('Failed to save receipt.');
      showToast(getErrorMessage(e, 'Failed to save receipt. Conflict may have occurred.'), "error");
    } finally {
      if (isActiveReceipt()) setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!user || !receipt) return;
    const scope = sessionActions.capture();
    if (!scope) return;
    const receiptId = receipt.id;
    const isActiveReceipt = () => sessionActions.isActive(scope) && activeReceiptIdRef.current === receiptId;
    if (window.confirm('Delete this receipt?')) {
      try {
        await receiptRepository.deleteReceipt(scope.uid, receiptId);
        if (!isActiveReceipt()) return;
        ImageSessionStore.deleteForUser(scope.uid, receiptId);
        clearImagePreview();
        navigate('/');
      } catch {
        if (!isActiveReceipt()) return;
        console.error('Failed to delete receipt.');
        showToast("Failed to delete receipt", "error");
      }
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading...</div>;
  if (error || !receipt) return <div className="p-8 text-center text-red-600">{error}</div>;

  return (
    <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-6 pb-24">
      {/* Left side: Preview */}
      <div className="flex-1 md:max-w-[40%] flex flex-col space-y-4">
        <header className="flex items-center gap-3">
           <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
             <ArrowLeft size={20} />
           </button>
           <h1 className="text-xl font-bold text-gray-900">Review Receipt</h1>
        </header>

        {imageUrl ? (
          <div className="bg-gray-100 border border-gray-200 rounded-2xl overflow-hidden shadow-inner flex items-center justify-center sticky top-24" style={{ height: 'calc(100vh - 120px)' }}>
            <img src={imageUrl} alt="Receipt Preview" className="max-w-full max-h-full object-contain" />
          </div>
        ) : (
          <div className="bg-orange-50 border border-orange-200 p-6 rounded-2xl flex flex-col items-center justify-center text-center">
            <AlertTriangle size={32} className="text-orange-400 mb-3" />
            <h3 className="font-bold text-orange-900">Image missing</h3>
            <p className="text-orange-700 mt-2 text-sm">
              Original image not stored. Reattach temporarily if needed.
            </p>
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleReattach} />
            <button onClick={() => fileInputRef.current?.click()} className="mt-4 flex items-center gap-2 px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700">
              <Upload size={16} /> Reattach
            </button>
            {reattachError && <p className="text-red-600 text-sm mt-3">{reattachError}</p>}
          </div>
        )}
      </div>
      
      {/* Right side: Edit Form */}
      <div className="flex-1 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm overflow-auto" style={{ maxHeight: 'calc(100vh - 120px)' }}>
         
          {duplicates.length > 0 && (
           <div className="mb-6 bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm">
             <div className="flex items-start gap-2 text-orange-800">
               <AlertTriangle size={18} className="mt-0.5 shrink-0 text-orange-500" />
               <div>
                 <p className="font-bold text-base mb-1">Possible Duplicate</p>
                 <p className="opacity-90 mb-3">Found {duplicates.length} other receipt(s) with the same merchant, date, and total.</p>
                 <div className="flex gap-2">
                   <button onClick={() => handleDelete()} className="px-3 py-1.5 bg-white border border-orange-200 rounded shadow-sm font-medium hover:bg-orange-50">Discard New</button>
                   <button onClick={() => window.open(`/receipts?id=${duplicates[0].id}`, '_blank')} className="px-3 py-1.5 bg-white border border-orange-200 rounded shadow-sm font-medium hover:bg-orange-50">View Existing</button>
                 </div>
               </div>
             </div>
           </div>
          )}

          {(formData.warnings || []).length > 0 && (
            <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <p className="font-bold text-base mb-1">Extraction notes</p>
                  <ul className="list-disc pl-5 space-y-1">
                    {formData.warnings?.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          )}
         
         <div className="space-y-8">
           <section>
             <h3 className="text-lg font-bold text-gray-900 border-b pb-2 mb-4">Header Info</h3>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Merchant (Normalized)</label>
                 <input type="text" value={formData.merchantNormalized || ''} onChange={e => updateField('merchantNormalized', e.target.value)} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm" />
               </div>
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Merchant (Raw)</label>
                 <input type="text" value={formData.merchantRaw || ''} onChange={e => updateField('merchantRaw', e.target.value)} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-gray-50" />
               </div>
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Branch/Address</label>
                 <input type="text" value={formData.branchAddress || ''} onChange={e => updateField('branchAddress', e.target.value)} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm" />
               </div>
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Receipt Number</label>
                 <input type="text" value={formData.receiptNumber || ''} onChange={e => updateField('receiptNumber', e.target.value)} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm" />
               </div>
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                 <input type="date" value={formData.transactionDate || ''} onChange={e => updateField('transactionDate', e.target.value || null)} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm" />
               </div>
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                 <input type="time" value={formData.transactionTime || ''} onChange={e => updateField('transactionTime', e.target.value || null)} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm" />
               </div>
               <div className="sm:col-span-2 flex items-center gap-2">
                 <input type="checkbox" id="dateAmbiguous" checked={formData.dateAmbiguous || false} onChange={e => updateField('dateAmbiguous', e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                 <label htmlFor="dateAmbiguous" className="text-sm text-gray-700">Date was ambiguous (e.g. DD/MM vs MM/DD)</label>
               </div>
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                 <input type="text" value={formData.currency || ''} onChange={e => updateField('currency', e.target.value)} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm" />
               </div>
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                 <input type="text" value={formData.paymentMethod || ''} onChange={e => updateField('paymentMethod', e.target.value)} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm" />
               </div>
             </div>
           </section>

           <section>
             <div className="flex justify-between items-center border-b pb-2 mb-4">
                <h3 className="text-lg font-bold text-gray-900">Items ({currentItems.length}/{MAX_RECEIPT_ITEMS})</h3>
                <button onClick={addItem} disabled={currentItems.length >= MAX_RECEIPT_ITEMS} className="text-sm font-medium text-blue-600 flex items-center gap-1 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed"><Plus size={16}/> Add Item</button>
             </div>
             
             <div className="space-y-4">
               {currentItems.map((item, index) => (
                 <div key={item.id} className="bg-gray-50 border border-gray-200 rounded-xl p-4 relative group">
                   <button onClick={() => removeItem(index)} className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600 hover:bg-white rounded transition-colors" title="Remove Item"><Trash2 size={16}/></button>
                   <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pr-8">
                     <div className="sm:col-span-5">
                       <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                       <input type="text" value={item.name || ''} onChange={e => updateItem(index, 'name', e.target.value)} className="w-full border-gray-300 rounded text-sm px-2 py-1.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500" placeholder="Item name" />
                     </div>
                     <div className="sm:col-span-2">
                       <label className="block text-xs font-medium text-gray-500 mb-1">Qty</label>
                       <input type="number" step="any" value={item.quantity === null ? '' : item.quantity} onChange={e => updateItem(index, 'quantity', e.target.value ? Number(e.target.value) : null)} className="w-full border-gray-300 rounded text-sm px-2 py-1.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
                     </div>
                     <div className="sm:col-span-2">
                       <label className="block text-xs font-medium text-gray-500 mb-1">Price</label>
                       <input type="text" value={minorToStr(item.unitPrice)} onChange={e => updateItem(index, 'unitPrice', strToMinor(e.target.value))} className="w-full border-gray-300 rounded text-sm px-2 py-1.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500" placeholder="0.00" />
                     </div>
                     <div className="sm:col-span-3">
                       <label className="block text-xs font-medium text-gray-500 mb-1">Line Total</label>
                       <input type="text" value={minorToStr(item.lineTotal)} onChange={e => updateItem(index, 'lineTotal', strToMinor(e.target.value))} className="w-full border-gray-300 rounded text-sm px-2 py-1.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-medium" placeholder="0.00" />
                     </div>
                     <div className="sm:col-span-6">
                       <label className="block text-xs font-medium text-gray-500 mb-1">Raw Line Text (OCR)</label>
                       <input type="text" value={item.rawLineText || ''} onChange={e => updateItem(index, 'rawLineText', e.target.value)} className="w-full border-gray-300 rounded text-xs px-2 py-1.5 bg-gray-100 text-gray-600 focus:bg-white" />
                     </div>
                     <div className="sm:col-span-6">
                       <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                       <select
                         value={resolveReceiptItemCategoryId(item, categories) || ''}
                         onChange={e => updateItem(index, 'categoryId', e.target.value)}
                         className="w-full border-gray-300 rounded text-sm px-2 py-1.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                       >
                         <option value="">Uncategorized</option>
                         {categories
                           .filter(category => category.isActive || category.id === item.categoryId)
                           .map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                       </select>
                     </div>
                   </div>
                 </div>
               ))}
               {currentItems.length === 0 && <p className="text-center text-gray-500 text-sm py-4">No items listed.</p>}
             </div>
           </section>

           <section>
             <h3 className="text-lg font-bold text-gray-900 border-b pb-2 mb-4">Totals & Reconciliation</h3>
             
             {reconciliation.reconciliationStatus === 'mismatched' && (
               <div className="mb-4 bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg flex items-start gap-2 text-sm">
                 <AlertTriangle size={18} className="shrink-0 mt-0.5 text-red-600" />
                 <div>
                   <p className="font-bold">Totals Mismatch</p>
                   <ul className="list-disc pl-4 mt-1 opacity-90">
                     {reconciliation.warnings.map((w, i) => <li key={i}>{w}</li>)}
                   </ul>
                   <p className="mt-2">Computed item total: {minorToStr(reconciliation.computedLineTotal)}<br/>
                   Expected grand total: {minorToStr(reconciliation.computedExpectedTotal)}<br/>
                   Discrepancy: {minorToStr(reconciliation.discrepancy)}</p>
                 </div>
               </div>
             )}
             
             <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Printed Subtotal</label>
                 <input type="text" value={minorToStr(formData.printedSubtotal)} onChange={e => updateField('printedSubtotal', strToMinor(e.target.value))} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 sm:text-sm" />
               </div>
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Printed Discount</label>
                 <input type="text" value={minorToStr(formData.printedDiscount)} onChange={e => updateField('printedDiscount', strToMinor(e.target.value))} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 sm:text-sm" />
               </div>
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Printed Tax</label>
                 <input type="text" value={minorToStr(formData.printedTax)} onChange={e => updateField('printedTax', strToMinor(e.target.value))} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 sm:text-sm" />
               </div>
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Printed Fees</label>
                 <input type="text" value={minorToStr(formData.printedFees)} onChange={e => updateField('printedFees', strToMinor(e.target.value))} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 sm:text-sm" />
               </div>
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Printed Rounding</label>
                 <input type="text" value={minorToStr(formData.printedRounding)} onChange={e => updateField('printedRounding', strToMinor(e.target.value))} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 sm:text-sm" />
               </div>
               <div>
                 <label className="block text-sm font-bold text-gray-900 mb-1">Printed Grand Total</label>
                 <input type="text" value={minorToStr(formData.printedGrandTotal)} onChange={e => updateField('printedGrandTotal', strToMinor(e.target.value))} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 sm:text-sm font-bold bg-blue-50" />
               </div>
             </div>
           </section>

           <section>
             <h3 className="text-lg font-bold text-gray-900 border-b pb-2 mb-4">Notes & Raw Data</h3>
             <div className="space-y-4">
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">User Notes</label>
                 <textarea value={formData.userNote || ''} onChange={e => updateField('userNote', e.target.value)} rows={3} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 sm:text-sm" placeholder="Add personal notes..." />
               </div>
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Raw OCR Text</label>
                 <textarea value={formData.rawOcrText || ''} readOnly rows={6} className="w-full border-gray-300 rounded-md shadow-sm bg-gray-50 text-xs font-mono text-gray-600 cursor-text" />
               </div>
             </div>
           </section>
           
         </div>

         <div className="sticky bottom-0 mt-8 pt-4 pb-4 bg-white border-t border-gray-200 flex flex-wrap gap-3">
            <button 
              onClick={() => handleSave('confirmed')}
              disabled={isSaving}
              className="flex-1 min-w-[200px] flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors">
              <Check size={20} /> {isSaving ? 'Saving...' : 'Confirm & Save'}
            </button>
            <button 
              onClick={() => handleSave('pendingReview')}
              disabled={isSaving}
              className="px-6 py-3 bg-white border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors">
              Save Draft
            </button>
            <button 
              onClick={handleDelete}
              disabled={isSaving}
              className="px-6 py-3 bg-white border border-gray-300 text-red-600 font-medium rounded-xl hover:bg-red-50 disabled:opacity-50 transition-colors ml-auto">
              <Trash2 size={20} />
            </button>
         </div>
      </div>
    </div>
  );
}
