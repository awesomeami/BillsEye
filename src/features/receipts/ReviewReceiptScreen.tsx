import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, Plus, Trash2, Upload } from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { APP_CONFIG } from '../../utilities/config';
import { useAuth } from '../auth/AuthContext';
import { MAX_RECEIPT_ITEMS, ReceiptDocument } from '../../domain/schema';
import { ImageSessionStore } from '../../utils/imageSessionStore';
import { createSha256Hash, preprocessImage } from '../../utils/imageUtils';
import { aliasRepository, receiptRepository, ReceiptRevisionConflictError } from '../../services/firebase/db';
import { calculateReceiptTotals } from '../../domain/reconciliation';
import { applyMerchantCategoryAlias, canonicalizeReceiptItemCategories, resolveReceiptItemCategoryId } from '../../domain/categories';
import { useReceiptsLibrary } from './library/ReceiptsLibraryContext';
import { useClientSessionActionGuard } from '../auth/useClientSessionActionGuard';
import { useReceiptQueue } from './queue/ReceiptQueueContext';
import { usePwaUpdateReadiness } from '../pwa/PwaUpdateProvider';
import {
  applyAuthoritativeReceiptSave,
  isReceiptEditorDirty,
  itemMoneyKey,
  isReceiptRevisionConflict,
  materializeReceiptMoneyText,
  MoneyTextState,
  MoneyValidationErrors,
  parseEditableMinor,
  receiptMoneyKey,
  ReceiptMoneyField,
  shouldBlockReceiptNavigation,
} from './editorState';

type ReceiptItem = ReceiptDocument['items'][number];
type SaveStatus = 'confirmed' | 'pendingReview';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function minorToText(value: number | null | undefined): string {
  return value == null ? '' : (value / 100).toFixed(2);
}

function displayMinor(value: number | null | undefined): string {
  return value == null ? 'Unavailable' : minorToText(value);
}

function isRevisionConflict(error: unknown): boolean {
  return error instanceof ReceiptRevisionConflictError
    || isReceiptRevisionConflict(error);
}

function MoneyInput({ id, label, value, error, className = '', onChange, onBlur }: {
  id: string; label: string; value: string; error?: string; className?: string;
  onChange: (value: string) => void; onBlur: () => void;
}) {
  const errorId = id + '-error';
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input id={id} type="text" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
        className={'w-full border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ' + (error ? 'border-red-500 ' : 'border-gray-300 ') + className} />
      {error && <p id={errorId} className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function TextInput({ id, label, value, onChange, type = 'text' }: {
  id: string; label: string; value: string; type?: 'text' | 'date' | 'time';
  onChange: (value: string) => void;
}) {
  return <div><label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label><input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm" /></div>;
}

export function ReviewReceiptScreen() {
  const { id } = useParams();
  const { user } = useAuth();
  const userId = user?.uid;
  const { showToast } = useToast();
  const { categories, settings } = useReceiptsLibrary();
  const { finalizeReceipt, releaseReceiptForReview } = useReceiptQueue();
  const { setReceiptEditorDirty } = usePwaUpdateReadiness();
  const sessionActions = useClientSessionActionGuard();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<ReceiptDocument | null>(null);
  const [formData, setFormData] = useState<Partial<ReceiptDocument>>({});
  const [baseline, setBaseline] = useState<Partial<ReceiptDocument> | null>(null);
  const [moneyText, setMoneyText] = useState<MoneyTextState>({});
  const [moneyErrors, setMoneyErrors] = useState<MoneyValidationErrors>({});
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reattachError, setReattachError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<ReceiptDocument[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [conflict, setConflict] = useState<{ latest: ReceiptDocument | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveInFlightRef = useRef(false);
  const deleteInFlightRef = useRef(false);
  const imageUrlRef = useRef<string | null>(null);
  const activeReceiptIdRef = useRef<string | null>(id ?? null);
  activeReceiptIdRef.current = id ?? null;

  useEffect(() => {
    if (id) releaseReceiptForReview(id);
  }, [id, releaseReceiptForReview]);

  const clearImagePreview = useCallback(() => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    imageUrlRef.current = null;
    setImageUrl(null);
  }, []);

  const setImagePreview = useCallback((image: Blob) => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    const next = URL.createObjectURL(image);
    imageUrlRef.current = next;
    setImageUrl(next);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setReceipt(null);
    setBaseline(null);
    setMoneyText({});
    setMoneyErrors({});
    async function load() {
      if (!userId || !id) {
        if (active) setLoading(false);
        return;
      }
      try {
        const data = await receiptRepository.getReceipt(userId, id);
        if (!data) {
          if (active) setLoadError('Receipt not found or cannot be reviewed safely.');
          return;
        }
        const alias = data.merchantNormalized ? await aliasRepository.getAliasForMerchant(userId, data.merchantNormalized) : null;
        if (!active) return;
        const draft: ReceiptDocument = { ...data, items: alias ? applyMerchantCategoryAlias(data.items, alias.categoryId) : data.items };
        const editor = applyAuthoritativeReceiptSave(draft);
        setReceipt(editor.receipt);
        setFormData(editor.draft);
        setBaseline(editor.baseline);
        if (data.merchantNormalized && data.transactionDate && data.printedGrandTotal != null) {
          const possible = await receiptRepository.findPossibleDuplicates(userId, data.merchantNormalized, data.transactionDate, data.printedGrandTotal);
          if (active) setDuplicates(possible.filter((candidate) => candidate.id !== data.id));
        }
        const sessionImage = ImageSessionStore.getForUser(userId, id);
        if (active && sessionImage) setImagePreview(sessionImage);
      } catch (error: unknown) {
        if (active) setLoadError(errorMessage(error, 'Could not load this receipt.'));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      clearImagePreview();
    };
  }, [id, userId, clearImagePreview, setImagePreview]);

  const isDirty = !loading && isReceiptEditorDirty(baseline, formData, moneyText);
  useEffect(() => {
    if (!id) return;
    setReceiptEditorDirty(id, isDirty);
    return () => setReceiptEditorDirty(id, false);
  }, [id, isDirty, setReceiptEditorDirty]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => shouldBlockReceiptNavigation(isDirty, isSaving, currentLocation.pathname, nextLocation.pathname));
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const updateDraft = (updater: (draft: Partial<ReceiptDocument>) => Partial<ReceiptDocument>) => {
    setFormData((draft) => ({ ...updater(draft), wasEditedByUser: true }));
  };
  const updateField = <K extends keyof ReceiptDocument>(field: K, value: ReceiptDocument[K]) => updateDraft((draft) => ({ ...draft, [field]: value }));
  const updateItem = <K extends keyof ReceiptItem>(index: number, field: K, value: ReceiptItem[K]) => updateDraft((draft) => {
    const items = [...(draft.items ?? [])];
    if (field === 'categoryId') {
      const { category: _legacyCategory, ...withoutLegacyCategory } = items[index];
      items[index] = { ...withoutLegacyCategory, categoryId: typeof value === 'string' && value ? value : null, userEdited: true };
    } else {
      items[index] = { ...items[index], [field]: value, userEdited: true };
    }
    return { ...draft, items };
  });

  const editMoney = (key: string, text: string) => {
    setMoneyText((current) => ({ ...current, [key]: text }));
    setMoneyErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    updateDraft((draft) => draft);
  };
  const commitMoney = (key: string, apply: (value: number | null) => void) => {
    const text = moneyText[key];
    if (text === undefined) return;
    const parsed = parseEditableMinor(text);
    if (parsed === undefined) {
      setMoneyErrors((current) => ({ ...current, [key]: 'Enter a valid amount.' }));
      return;
    }
    apply(parsed);
    setMoneyText((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const items = useMemo(() => formData.items ?? [], [formData.items]);
  const reconciliation = useMemo(() => calculateReceiptTotals(items, {
    printedSubtotal: formData.printedSubtotal,
    printedDiscount: formData.printedDiscount,
    printedTax: formData.printedTax,
    printedFees: formData.printedFees,
    printedRounding: formData.printedRounding,
    printedGrandTotal: formData.printedGrandTotal,
  }, settings.discrepancyTolerance), [items, formData.printedSubtotal, formData.printedDiscount, formData.printedTax, formData.printedFees, formData.printedRounding, formData.printedGrandTotal, settings.discrepancyTolerance]);

  const addItem = () => {
    if (items.length >= MAX_RECEIPT_ITEMS) {
      showToast('Receipts support up to ' + MAX_RECEIPT_ITEMS + ' items. Remove an item before adding another.', 'error');
      return;
    }
    updateDraft((draft) => ({
      ...draft,
      items: [...(draft.items ?? []), { id: crypto.randomUUID(), rawLineText: '', name: null, brand: null, quantity: 1, unit: null, unitPrice: null, discount: null, lineTotal: null, categoryId: null, confidence: 1, userEdited: true, warnings: [] }],
    }));
  };
  const removeItem = (index: number) => updateDraft((draft) => {
    const next = [...(draft.items ?? [])];
    next.splice(index, 1);
    return { ...draft, items: next };
  });

  const handleReattach = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !receipt || !userId) return;
    const scope = sessionActions.capture();
    if (!scope) return;
    const receiptId = receipt.id;
    const active = () => sessionActions.isActive(scope) && activeReceiptIdRef.current === receiptId;
    setReattachError(null);
    try {
      const processed = await preprocessImage(file);
      if (!active()) return;
      const hash = await createSha256Hash(processed.blob);
      if (!active()) return;
      if (hash !== receipt.sourceSha256) setReattachError('Hash mismatch. This is not the original file.');
      else {
        ImageSessionStore.setForUser(scope.uid, receiptId, processed.blob);
        setImagePreview(processed.blob);
      }
    } catch (error: unknown) {
      if (active()) setReattachError(errorMessage(error, 'Could not prepare the selected image.'));
    }
    if (active()) event.target.value = '';
  };

  const save = async (status: SaveStatus) => {
    if (!receipt || !userId || isSaving || saveInFlightRef.current) return;
    const materialized = materializeReceiptMoneyText(formData, moneyText);
    if (!materialized.draft) {
      setMoneyErrors(materialized.errors);
      showToast('Resolve the highlighted amount fields before saving.', 'error');
      return;
    }
    if (APP_CONFIG.currency === 'PKR' && materialized.draft.currency !== 'PKR') {
      showToast('This app is configured for PKR only. Please resolve the currency to PKR before saving.', 'error');
      return;
    }
    const scope = sessionActions.capture();
    if (!scope) return;
    const receiptId = receipt.id;
    const active = () => sessionActions.isActive(scope) && activeReceiptIdRef.current === receiptId;
    saveInFlightRef.current = true;
    setIsSaving(true);
    try {
      const savedReconciliation = calculateReceiptTotals(materialized.draft.items ?? [], {
        printedSubtotal: materialized.draft.printedSubtotal,
        printedDiscount: materialized.draft.printedDiscount,
        printedTax: materialized.draft.printedTax,
        printedFees: materialized.draft.printedFees,
        printedRounding: materialized.draft.printedRounding,
        printedGrandTotal: materialized.draft.printedGrandTotal,
      }, settings.discrepancyTolerance);
      const payload: Partial<ReceiptDocument> = {
        ...materialized.draft,
        items: canonicalizeReceiptItemCategories(materialized.draft.items ?? [], categories),
        status,
        confirmedAt: status === 'confirmed' ? receipt.confirmedAt ?? new Date().toISOString() : null,
        computedLineTotal: savedReconciliation.computedLineTotal,
        computedExpectedTotal: savedReconciliation.computedExpectedTotal,
        discrepancy: savedReconciliation.discrepancy,
        reconciliationStatus: savedReconciliation.reconciliationStatus,
      };
      const saved = await receiptRepository.updateReceipt(scope.uid, receiptId, payload, receipt.revision);
      if (!active()) return;
      const editor = applyAuthoritativeReceiptSave(saved);
      setReceipt(editor.receipt);
      setFormData(editor.draft);
      setBaseline(editor.baseline);
      setMoneyText(editor.moneyText);
      setMoneyErrors({});
      if (status === 'confirmed') {
        finalizeReceipt(receiptId);
        clearImagePreview();
        navigate('/');
      } else {
        showToast('Draft saved.', 'success');
      }
    } catch (error: unknown) {
      if (!active()) return;
      if (isRevisionConflict(error)) {
        let latest: ReceiptDocument | null = null;
        try {
          latest = await receiptRepository.getReceipt(scope.uid, receiptId);
        } catch {
          // The local form remains available even if the recovery fetch is unavailable.
        }
        if (active()) setConflict({ latest });
      } else {
        console.error('Failed to save receipt.');
        showToast(errorMessage(error, 'Failed to save receipt.'), 'error');
      }
    } finally {
      saveInFlightRef.current = false;
      if (active()) setIsSaving(false);
    }
  };

  const deleteReceipt = async () => {
    if (!receipt || isDeleting || deleteInFlightRef.current) return;
    const scope = sessionActions.capture();
    if (!scope) return;
    const receiptId = receipt.id;
    const active = () => sessionActions.isActive(scope) && activeReceiptIdRef.current === receiptId;
    deleteInFlightRef.current = true;
    setIsDeleting(true);
    try {
      await receiptRepository.deleteReceipt(scope.uid, receiptId);
      if (!active()) return;
      finalizeReceipt(receiptId);
      clearImagePreview();
      navigate('/');
    } catch {
      if (active()) showToast('Failed to delete receipt.', 'error');
    } finally {
      deleteInFlightRef.current = false;
      if (active()) {
        setIsDeleting(false);
        setDeleteDialogOpen(false);
      }
    }
  };

  const useLatest = () => {
    if (!conflict?.latest) return;
    const editor = applyAuthoritativeReceiptSave(conflict.latest);
    setReceipt(editor.receipt);
    setFormData(editor.draft);
    setBaseline(editor.baseline);
    setMoneyText(editor.moneyText);
    setMoneyErrors({});
    setConflict(null);
  };
  const keepMyEdits = () => {
    if (conflict?.latest) {
      setReceipt(conflict.latest);
      setBaseline({ ...conflict.latest, items: conflict.latest.items.map((item) => ({ ...item })) });
    }
    setConflict(null);
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading...</div>;
  if (loadError || !receipt) return <div className="p-8 text-center text-red-600">{loadError}</div>;

  const receiptValue = (field: ReceiptMoneyField) => moneyText[receiptMoneyKey(field)] ?? minorToText(formData[field] as number | null | undefined);
  const itemValue = (item: ReceiptItem, field: 'unitPrice' | 'lineTotal') => moneyText[itemMoneyKey(item.id, field)] ?? minorToText(item[field]);

  return (
    <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-6 pb-40 md:pb-28">
      <aside className="flex-1 md:max-w-[40%] space-y-4">
        <header className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Go back" className="touch-target p-2 hover:bg-gray-100 rounded-full"><ArrowLeft size={20} /></button>
          <h1 className="text-xl font-bold text-gray-900">Review Receipt</h1>
          {isDirty && <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded">Unsaved changes</span>}
        </header>
        {imageUrl ? <div className="bg-gray-100 border border-gray-200 rounded-2xl overflow-hidden shadow-inner flex items-center justify-center md:sticky md:top-24" style={{ height: 'calc(100vh - 120px)' }}><img src={imageUrl} alt="Receipt Preview" className="max-w-full max-h-full object-contain" /></div> : (
          <div className="bg-orange-50 border border-orange-200 p-6 rounded-2xl text-center">
            <AlertTriangle size={32} className="text-orange-400 mx-auto mb-3" /><h2 className="font-bold text-orange-900">Image missing</h2>
            <p className="text-orange-700 mt-2 text-sm">Original image not stored. Reattach temporarily if needed.</p>
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleReattach} />
            <button onClick={() => fileInputRef.current?.click()} className="touch-target mt-4 inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg"><Upload size={16} /> Reattach</button>
            {reattachError && <p className="text-red-600 text-sm mt-3">{reattachError}</p>}
          </div>
        )}
      </aside>

      <main className="flex-1 bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 shadow-sm min-w-0">
        {duplicates.length > 0 && <div className="mb-6 bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-orange-800"><p className="font-bold">Possible Duplicate</p><p>Found {duplicates.length} other receipt(s) with the same merchant, date, and total.</p></div>}
        <div className="space-y-8 pb-36">
          <section>
            <h2 className="text-lg font-bold text-gray-900 border-b pb-2 mb-4">Header Info</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TextInput id="merchant-normalized" label="Merchant (Normalized)" value={formData.merchantNormalized ?? ''} onChange={(value) => updateField('merchantNormalized', value)} />
              <TextInput id="merchant-raw" label="Merchant (Raw)" value={formData.merchantRaw ?? ''} onChange={(value) => updateField('merchantRaw', value)} />
              <TextInput id="branch-address" label="Branch/Address" value={formData.branchAddress ?? ''} onChange={(value) => updateField('branchAddress', value)} />
              <TextInput id="receipt-number" label="Receipt Number" value={formData.receiptNumber ?? ''} onChange={(value) => updateField('receiptNumber', value)} />
              <TextInput id="transaction-date" label="Date" type="date" value={formData.transactionDate ?? ''} onChange={(value) => updateField('transactionDate', value || null)} />
              <TextInput id="transaction-time" label="Time" type="time" value={formData.transactionTime ?? ''} onChange={(value) => updateField('transactionTime', value || null)} />
              <div className="sm:col-span-2 flex items-center gap-2"><input id="date-ambiguous" type="checkbox" checked={formData.dateAmbiguous ?? false} onChange={(event) => updateField('dateAmbiguous', event.target.checked)} /><label htmlFor="date-ambiguous" className="text-sm text-gray-700">Date was ambiguous</label></div>
              <TextInput id="currency" label="Currency" value={formData.currency ?? ''} onChange={(value) => updateField('currency', value)} />
              <TextInput id="payment-method" label="Payment Method" value={formData.paymentMethod ?? ''} onChange={(value) => updateField('paymentMethod', value)} />
            </div>
          </section>

          <section>
            <div className="flex justify-between items-center border-b pb-2 mb-4"><h2 className="text-lg font-bold text-gray-900">Items ({items.length}/{MAX_RECEIPT_ITEMS})</h2><button onClick={addItem} disabled={items.length >= MAX_RECEIPT_ITEMS} className="touch-target text-sm font-medium text-blue-700 flex items-center gap-1 disabled:text-gray-400"><Plus size={16} /> Add Item</button></div>
            <div className="space-y-4">
              {items.map((item, index) => {
                const prefix = 'item-' + item.id;
                const unitKey = itemMoneyKey(item.id, 'unitPrice');
                const totalKey = itemMoneyKey(item.id, 'lineTotal');
                return <div key={item.id} className="bg-gray-50 border border-gray-200 rounded-xl p-4 relative">
                  <button onClick={() => removeItem(index)} aria-label={'Remove item ' + (index + 1)} className="touch-target absolute top-1 right-1 p-1 text-gray-500 hover:text-red-700"><Trash2 size={16} /></button>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pr-8">
                    <div className="sm:col-span-5"><TextInput id={prefix + '-name'} label="Name" value={item.name ?? ''} onChange={(value) => updateItem(index, 'name', value)} /></div>
                    <div className="sm:col-span-2"><TextInput id={prefix + '-quantity'} label="Qty" value={item.quantity == null ? '' : String(item.quantity)} onChange={(value) => updateItem(index, 'quantity', value === '' ? null : Number(value))} /></div>
                    <div className="sm:col-span-2"><MoneyInput id={prefix + '-price'} label="Price" value={itemValue(item, 'unitPrice')} error={moneyErrors[unitKey]} onChange={(value) => editMoney(unitKey, value)} onBlur={() => commitMoney(unitKey, (value) => updateItem(index, 'unitPrice', value))} /></div>
                    <div className="sm:col-span-3"><MoneyInput id={prefix + '-line-total'} label="Line Total" value={itemValue(item, 'lineTotal')} error={moneyErrors[totalKey]} onChange={(value) => editMoney(totalKey, value)} onBlur={() => commitMoney(totalKey, (value) => updateItem(index, 'lineTotal', value))} /></div>
                    <div className="sm:col-span-6"><TextInput id={prefix + '-raw'} label="Raw Line Text (OCR)" value={item.rawLineText ?? ''} onChange={(value) => updateItem(index, 'rawLineText', value)} /></div>
                    <div className="sm:col-span-6"><label htmlFor={prefix + '-category'} className="block text-sm font-medium text-gray-700 mb-1">Category</label><select id={prefix + '-category'} value={resolveReceiptItemCategoryId(item, categories) ?? ''} onChange={(event) => updateItem(index, 'categoryId', event.target.value)} className="w-full border border-gray-300 rounded text-sm px-2 py-1.5"><option value="">Uncategorized</option>{categories.filter((category) => category.isActive || category.id === item.categoryId).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
                  </div>
                </div>;
              })}
              {items.length === 0 && <p className="text-center text-gray-500 text-sm py-4">No items listed.</p>}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 border-b pb-2 mb-4">Totals & Reconciliation</h2>
            {reconciliation.reconciliationStatus === 'mismatched' && <div className="mb-4 bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg text-sm"><p className="font-bold">Totals Mismatch</p><p className="mt-2">Calculated line subtotal: {displayMinor(reconciliation.computedLineTotal)}<br />Calculated grand total: {displayMinor(reconciliation.computedExpectedTotal)}<br />Printed total − calculated total: {displayMinor(reconciliation.discrepancy)}</p></div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {([['printedSubtotal', 'Printed Subtotal'], ['printedDiscount', 'Printed Discount'], ['printedTax', 'Printed Tax'], ['printedFees', 'Printed Fees'], ['printedRounding', 'Printed Rounding'], ['printedGrandTotal', 'Printed Grand Total']] as const).map(([field, label]) => {
                const key = receiptMoneyKey(field);
                return <MoneyInput key={field} id={field} label={label} value={receiptValue(field)} error={moneyErrors[key]} className={field === 'printedGrandTotal' ? 'font-bold bg-blue-50' : ''} onChange={(value) => editMoney(key, value)} onBlur={() => commitMoney(key, (value) => updateField(field, value))} />;
              })}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 border-b pb-2 mb-4">Notes & Raw Data</h2>
            <div className="space-y-4"><div><label htmlFor="user-note" className="block text-sm font-medium text-gray-700 mb-1">User Notes</label><textarea id="user-note" value={formData.userNote ?? ''} onChange={(event) => updateField('userNote', event.target.value)} rows={3} className="w-full border border-gray-300 rounded-md shadow-sm" /></div><div><label htmlFor="raw-ocr-text" className="block text-sm font-medium text-gray-700 mb-1">Raw OCR Text</label><textarea id="raw-ocr-text" value={formData.rawOcrText ?? ''} readOnly rows={6} className="w-full border border-gray-300 rounded-md bg-gray-50 text-xs font-mono text-gray-600" /></div></div>
          </section>
        </div>

        <div aria-label="Receipt actions" className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-t border-gray-200 shadow-[0_-8px_20px_rgba(0,0,0,0.06)] flex flex-col sm:flex-row gap-3">
          <button onClick={() => void save('confirmed')} disabled={isSaving} className="touch-target flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-xl disabled:opacity-50"><Check size={20} /> {isSaving ? 'Saving...' : 'Confirm & Save'}</button>
          <button onClick={() => void save('pendingReview')} disabled={isSaving} className="touch-target px-6 py-3 bg-white border border-gray-300 text-gray-700 font-medium rounded-xl disabled:opacity-50">Save Draft</button>
          <button onClick={() => setDeleteDialogOpen(true)} disabled={isSaving || isDeleting} aria-label="Delete receipt" className="touch-target px-6 py-3 bg-white border border-gray-300 text-red-700 font-medium rounded-xl disabled:opacity-50"><Trash2 size={20} /></button>
        </div>
      </main>

      <ConfirmDialog isOpen={blocker.state === 'blocked'} title="Discard unsaved receipt changes?" message="Your edits have not been saved. Leave this editor and discard them?" confirmText="Discard changes" cancelText="Keep editing" isDestructive onConfirm={() => blocker.proceed?.()} onCancel={() => blocker.reset?.()} />
      <ConfirmDialog isOpen={deleteDialogOpen} title="Delete Receipt" message="Delete this receipt permanently? This action cannot be undone." confirmText={isDeleting ? 'Deleting…' : 'Delete'} cancelText="Cancel" isDestructive onConfirm={() => void deleteReceipt()} onCancel={() => !isDeleting && setDeleteDialogOpen(false)} />
      <ConfirmDialog isOpen={conflict !== null} title="Receipt changed elsewhere" message={conflict?.latest ? 'A newer receipt version (' + conflict.latest.revision + ') is available. Your edits are still preserved; choose which version to continue with.' : 'This receipt changed elsewhere. Your edits are preserved, but the latest version could not be loaded.'} confirmText="Use latest" cancelText="Keep my edits" onConfirm={useLatest} onCancel={keepMyEdits} />
    </div>
  );
}
