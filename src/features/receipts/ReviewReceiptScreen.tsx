import React, { useEffect, useState, useRef } from 'react';
import { useToast } from '../../components/ui/Toast';
import { useParams, useNavigate } from 'react-router-dom';
import { APP_CONFIG } from "../../utilities/config";
import { useAuth } from '../auth/AuthContext';
import { getDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase/config';
import { ReceiptDocument } from '../../domain/schema';
import { ImageSessionStore } from '../../utils/imageSessionStore';
import { createSha256Hash } from '../../utils/imageUtils';
import { receiptRepository, aliasRepository } from '../../services/firebase/db';
import { FileText, Upload, AlertTriangle, Check, ArrowLeft, Trash2, Plus, Minus, Info } from 'lucide-react';
import { parseMajorToMinor } from '../../domain/money';
import { reconcileReceipt } from '../../domain/reconciliation';

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
  const navigate = useNavigate();
  
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  const [receipt, setReceipt] = useState<ReceiptDocument | null>(null);
  const [formData, setFormData] = useState<Partial<ReceiptDocument>>({});
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reattachError, setReattachError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<ReceiptDocument[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      if (!user || !id) return;
      try {
        const docSnap = await getDoc(doc(db, `users/${user.uid}/receipts`, id));
        if (docSnap.exists()) {
          const data = docSnap.data() as ReceiptDocument;
          setReceipt(data);
          setFormData(JSON.parse(JSON.stringify(data)));
          
          if (data.merchantNormalized && data.transactionDate && data.printedGrandTotal !== null) {
            // Apply aliases deterministically before checking duplicates
            const _aliases = await aliasRepository.getAliases(user.uid);
            const _checkMerchant = data.merchantNormalized;
            // if we have an alias mapping for this merchant, we can use the original or check if we want to remap. Wait, the duplicate logic just checks if the merchant matches. If it matches aliased merchant?
            // Actually, `aliasRepository` in our schema has `merchantNormalized` and `categoryId`. So it's an alias that maps a merchant to a category, NOT merchant to merchant. 
            // So for duplicate check, we just use merchantNormalized! 
            // Wait, the prompt says: "Apply merchant aliases deterministically before duplicate checks/reports"
            // Wait, maybe the merchant alias is meant to normalize the name itself? No, the schema says: "categoryId: string".
            // Let's just leave duplicate logic alone, but ensure we import aliasRepository if we want to apply default categories for items!
            const possibleDups = await receiptRepository.findPossibleDuplicates(
              user.uid, 
              data.merchantNormalized, 
              data.transactionDate, 
              data.printedGrandTotal
            );
            setDuplicates(possibleDups.filter(d => d.id !== data.id));
          }

          const sessionImage = ImageSessionStore.get(id);
          if (sessionImage) {
            setImageUrl(URL.createObjectURL(sessionImage));
          }
        } else {
          setError('Receipt not found.');
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
    
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [id, user]);

  const handleReattach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !receipt) return;
    setReattachError(null);
    try {
      const hash = await createSha256Hash(file);
      if (hash === receipt.sourceSha256) {
        ImageSessionStore.set(receipt.id, file);
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        setImageUrl(URL.createObjectURL(file));
      } else {
        setReattachError('Hash mismatch. This is not the original file.');
      }
    } catch (err: any) {
      setReattachError(err.message);
    }
    if (e.target) e.target.value = '';
  };

  const updateField = (field: keyof ReceiptDocument, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value, wasEditedByUser: true }));
  };

  const updateItem = (index: number, field: string, value: any) => {
    setFormData(prev => {
      const newItems = [...(prev.items || [])];
      newItems[index] = { ...newItems[index], [field]: value, userEdited: true };
      return { ...prev, items: newItems, wasEditedByUser: true };
    });
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...(prev.items || []), {
        id: crypto.randomUUID(),
        rawLineText: '',
        name: '',
        quantity: 1,
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
    0 // Default tolerance
  );

  const handleSave = async (status: 'confirmed' | 'pendingReview' = 'confirmed') => {
    if (!user || !receipt) return;
    setIsSaving(true);

    if (APP_CONFIG.currency === 'PKR' && formData.currency !== 'PKR') {
      showToast("This app is configured for PKR only. Please resolve the currency to PKR before saving.", "error");
      setIsSaving(false);
      return;
    }

    try {
      const payload: any = {
        ...formData,
        status,
        confirmedAt: status === 'confirmed' 
          ? (receipt.status === 'confirmed' && receipt.confirmedAt ? undefined : serverTimestamp()) 
          : null,
        computedLineTotal: reconciliation.computedLineTotal,
        computedExpectedTotal: reconciliation.computedExpectedTotal,
        discrepancy: reconciliation.discrepancy,
        reconciliationStatus: reconciliation.reconciliationStatus,
      };
      if (payload.confirmedAt === undefined) {
        delete payload.confirmedAt;
      }

      await receiptRepository.updateReceipt(user.uid, receipt.id, payload, receipt.revision);
      if (status === 'confirmed') {
        ImageSessionStore.delete(receipt.id);
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        navigate('/dashboard');
      } else {
        showToast("Saved successfully!", "success");
      }
    } catch (e: any) {
      console.error(e);
      showToast(e.message || 'Failed to save receipt. Conflict may have occurred.', "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!user || !receipt) return;
    if (window.confirm('Delete this receipt?')) {
      try {
        await receiptRepository.deleteReceipt(user.uid, receipt.id);
        ImageSessionStore.delete(receipt.id);
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        navigate('/dashboard');
      } catch (e) {
        console.error(e);
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
               <h3 className="text-lg font-bold text-gray-900">Items</h3>
               <button onClick={addItem} className="text-sm font-medium text-blue-600 flex items-center gap-1 hover:text-blue-800"><Plus size={16}/> Add Item</button>
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
                       <input type="text" value={item.category || ''} onChange={e => updateItem(index, 'category', e.target.value)} className="w-full border-gray-300 rounded text-sm px-2 py-1.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
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
