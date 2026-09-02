import React, { useRef, useState, useEffect } from 'react';
import { useToast } from '../../components/ui/Toast';
import { Camera, Image as ImageIcon, FileText, Upload, X, RotateCw, Crop, CheckCircle2, AlertCircle, Clock, Search, ChevronRight, Slash } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useReceiptQueue } from '../receipts/queue/ReceiptQueueContext';
import { QueueItem, isRetryableQueueStatus } from '../receipts/queue/queueReducer';
import { ReceiptCropper } from '../receipts/queue/components/ReceiptCropper';
import { PdfPageSelector } from './PdfPageSelector';
import { PdfSelectionRequest, preparePdfSelections } from './pdfSelectionQueue';
import { formatCurrency } from '../../utilities/config';

export function AddReceiptScreen() {
  const { showToast } = useToast();

  const { items, addFiles, addPdfPages, removeItem, releaseForReview, cancelItem, retryItem, updateCroppedImage } = useReceiptQueue();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  
  const [dragActive, setDragActive] = useState(false);
  const [cropItem, setCropItem] = useState<QueueItem | null>(null);
  const [pdfSelections, setPdfSelections] = useState<PdfSelectionRequest[]>([]);
  const pdfToProcess = pdfSelections[0] ?? null;

  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processSelectedFiles = async (files: File[]) => {
    const images = files.filter(f => f.type.startsWith('image/'));
    const pdfs = files.filter(f => f.type === 'application/pdf');

    if (images.length > 0) {
      await addFiles(images);
    }

    if (pdfs.length > 0) {
      const { getPdfPageCount } = await import('./../../utils/pdfProcessor');
      const prepared = await preparePdfSelections(pdfs, getPdfPageCount);
      if (prepared.selections.length > 0) {
        setPdfSelections(current => [...current, ...prepared.selections]);
      }
      if (prepared.unreadableFiles.length > 0) {
        showToast(`Could not read ${prepared.unreadableFiles.join(', ')}.`, 'error');
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processSelectedFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processSelectedFiles(Array.from(e.target.files));
    }
    // reset input
    if (e.target) e.target.value = '';
  };

  const retryScheduled = () => {
    items.forEach(i => {
      if (isRetryableQueueStatus(i.status)) {
        retryItem(i.id);
      }
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-7 pb-24">
      <header className="page-header">
        <div>
          <h1 className="page-title">Add Receipts</h1>
          <p className="page-subtitle">Upload images or PDFs to extract data automatically.</p>
        </div>
      </header>

      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        multiple 
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={handleFileChange}
      />
      <input 
        type="file" 
        ref={imageInputRef} 
        className="hidden" 
        multiple 
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
      />
      <input 
        type="file" 
        ref={pdfInputRef} 
        className="hidden" 
        multiple
        accept="application/pdf"
        onChange={handleFileChange}
      />
      <input 
        type="file" 
        ref={cameraInputRef} 
        className="hidden" 
        capture="environment" 
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
      />

      {cropItem && cropItem.objectUrl && (
        <ReceiptCropper
          imageSrc={cropItem.objectUrl}
          onCancel={() => setCropItem(null)}
          onSave={async (blob) => {
             await updateCroppedImage(cropItem.id, blob);
             setCropItem(null);
          }}
        />
      )}

      {pdfToProcess && (
        <PdfPageSelector
          file={pdfToProcess.file}
          totalPages={pdfToProcess.totalPages}
          position={1}
          totalFiles={pdfSelections.length}
          onConfirm={(pages) => {
            addPdfPages(pdfToProcess.file, pages);
            setPdfSelections(current => current.slice(1));
          }}
          onCancel={() => {
            showToast(`${pdfToProcess.file.name} was skipped.`, 'info');
            setPdfSelections(current => current.slice(1));
          }}
        />
      )}

      {isOffline && (
        <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl flex items-start gap-3 text-orange-800">
          <AlertCircle size={20} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">You are offline</p>
            <p className="text-sm mt-1">Receipt extraction requires an internet connection to process images via Gemini AI. We do not support offline image queuing because images cannot be stored securely on the device.</p>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div 
          className={`grid grid-cols-1 gap-4 mt-6 ${dragActive ? 'bg-blue-50 rounded-3xl' : ''} ${isOffline ? 'opacity-50 pointer-events-none' : ''}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <div className="flex gap-3 border-l-4 border-blue-600 bg-blue-50 p-4 text-sm text-blue-900">
            <div className="mt-0.5 shrink-0"><Upload size={18} /></div>
            <div>
              <p className="font-medium">Privacy &amp; Memory Notice</p>
              <ul className="mt-1 space-y-1 text-blue-800">
                <li>Images are processed temporarily and are never saved permanently.</li>
                <li>Refreshing or closing the browser clears queued files and temporary previews.</li>
              </ul>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <button onClick={() => cameraInputRef.current?.click()} className="app-card group col-span-2 flex h-52 flex-col items-center justify-center border-2 border-dashed border-blue-300 p-6 hover:border-blue-600 hover:bg-blue-50/40 sm:col-span-1 sm:h-44">
              <div className="mb-4 rounded-md bg-blue-100 p-4">
                <Camera size={40} className="text-blue-700" />
              </div>
              <span className="text-lg font-medium text-gray-900">Take a Photo</span>
              <span className="mt-1 text-center text-sm text-gray-500">Use your device's rear camera</span>
            </button>

            <button
              onClick={() => imageInputRef.current?.click()}
              className="app-card flex h-52 cursor-pointer flex-col items-center justify-center p-5 hover:border-blue-300 hover:bg-blue-50/30 sm:h-44"
            >
              <div className="bg-gray-100 p-3 rounded-full mb-3">
                <ImageIcon size={24} className="text-gray-700" />
              </div>
              <span className="font-medium text-gray-900">Photo Library</span>
              <span className="text-xs text-gray-500 mt-1 text-center">JPG, PNG, WebP or Multiple</span>
            </button>
            
            <button
              onClick={() => pdfInputRef.current?.click()}
              className="app-card flex h-52 cursor-pointer flex-col items-center justify-center p-5 hover:border-blue-300 hover:bg-blue-50/30 sm:h-44"
            >
              <div className="bg-gray-100 p-3 rounded-full mb-3">
                <FileText size={24} className="text-gray-700" />
              </div>
              <span className="font-medium text-gray-900">Upload PDF</span>
              <span className="mt-1 text-center text-xs text-gray-500">PDF pages render locally</span>
            </button>
          </div>
          <div className="mt-2 text-center text-sm text-gray-500">
             JPG, PNG and WebP supported. You can also drag and drop files here. HEIC files must be converted first.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="font-bold text-gray-900">Processing Queue ({items.length})</h3>
              <p className="text-sm text-gray-500">You can navigate elsewhere while processing continues. Refreshing or closing the browser loses queued files and temporary review images.</p>
            </div>
            <div className="flex gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-outline cursor-pointer"
                >
                  Add More
                </button>
                {items.some(i => isRetryableQueueStatus(i.status)) && (
                  <button
                    onClick={retryScheduled}
                    className="btn-primary cursor-pointer"
                  >
                    Retry Now
                  </button>
                )}
            </div>
          </div>

          <div className="space-y-3">
            {items.map(item => (
              <QueueItemCard
                key={item.id}
                item={item}
                onRemove={() => removeItem(item.id)}
                onReview={() => releaseForReview(item.id)}
                onRetry={() => retryItem(item.id)}
                onCrop={() => setCropItem(item)}
                onCancel={() => cancelItem(item.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QueueItemCard({ item, onRemove, onReview, onRetry, onCrop, onCancel }: { item: QueueItem, onRemove: () => void, onReview: () => void, onRetry: () => void, onCrop: () => void, onCancel: () => void }) {
  const getStatusDisplay = () => {
    switch (item.status) {
      case 'queued': return { text: 'Waiting...', icon: Clock, color: 'text-gray-500', bg: 'bg-gray-100' };
      case 'preprocessing': return { text: 'Preprocessing...', icon: RotateCw, color: 'text-blue-600', bg: 'bg-blue-100', spin: true };
      case 'duplicate-check': return { text: 'Checking duplicates...', icon: Search, color: 'text-blue-600', bg: 'bg-blue-100', spin: true };
      case 'extracting': return { text: 'Extracting data...', icon: RotateCw, color: 'text-purple-600', bg: 'bg-purple-100', spin: true };
      case 'needs-review': return { text: 'Needs Review', icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-100' };
      case 'duplicate': return { text: 'Exact Duplicate Skipped', icon: AlertCircle, color: 'text-orange-600', bg: 'bg-orange-100' };
      case 'retry-wait': return { text: 'Retry scheduled', icon: Clock, color: 'text-amber-700', bg: 'bg-amber-100' };
      case 'failed-permanent': return { text: 'Could not process — choose another file', icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100' };
      case 'cancelled': return { text: 'Cancelled', icon: Slash, color: 'text-gray-500', bg: 'bg-gray-200' };
      default: return { text: item.status, icon: Clock, color: 'text-gray-500', bg: 'bg-gray-100' };
    }
  };

  const statusInfo = getStatusDisplay();
  const Icon = statusInfo.icon;
  const extractedTotal = item.extractionResult?.printedGrandTotal;

  return (
    <div className={`app-card render-lazy grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 p-3 sm:grid-cols-[4rem_minmax(0,1fr)_auto] ${item.status === 'needs-review' ? 'receipt-reveal' : ''}`}>
      <div aria-live="polite" className="sr-only">
        {item.originalName} is {statusInfo.text}
      </div>
      <div className="w-16 h-16 shrink-0 bg-gray-100 rounded-lg overflow-hidden border border-gray-200 relative">
         {item.objectUrl ? (
           <img src={item.objectUrl} alt="Thumbnail" className="w-full h-full object-cover" />
         ) : (
           <div className="w-full h-full flex items-center justify-center text-gray-400">
             <FileText size={24} />
           </div>
         )}
         {item.status === 'queued' && item.objectUrl && (
            <button
              onClick={onCrop}
              aria-label={`Crop ${item.originalName}`}
              className="touch-target absolute right-0 bottom-0 flex items-center justify-center rounded-tl-lg bg-black/65 text-white hover:bg-black/80"
           >
             <Crop size={14} />
           </button>
         )}
      </div>
      
      <div className="flex-1 min-w-0">
         <h4 className="text-sm font-medium text-gray-900 truncate">{item.originalName}</h4>
         <div className="flex items-center gap-1.5 mt-1">
            <span className={`flex items-center justify-center w-5 h-5 rounded-full ${statusInfo.bg} ${statusInfo.color}`}>
              <Icon size={12} className={statusInfo.spin ? 'animate-spin' : ''} />
            </span>
            <span role="status" className={`text-xs font-medium ${statusInfo.color}`}>
              {statusInfo.text}
              {item.retryAfter && item.status === 'retry-wait' ? ` (Earliest: ${new Date(item.retryAfter).toLocaleTimeString()})` : ''}
            </span>
         </div>
         {item.status === 'needs-review' && extractedTotal != null ? (
           <span className="receipt-reveal-total">{formatCurrency(extractedTotal / 100)}</span>
         ) : null}
         {item.error && <p className="text-xs text-red-600 mt-1 truncate">{item.error}</p>}
      </div>
       <div className="col-span-2 flex flex-wrap items-center justify-end gap-1 border-t border-gray-100 pt-2 sm:col-span-1 sm:border-0 sm:pt-0">
        {item.status === 'needs-review' && item.receiptId && (
          <Link to={`/receipts/${item.receiptId}/review`} onClick={onReview} className="btn-ghost text-blue-700 hover:bg-blue-50">
            Review <ChevronRight size={16} />
          </Link>
        )}

        {item.status === 'needs-review' && (
          <button onClick={onRemove} aria-label={`Dismiss ${item.originalName} from the queue`} className="btn-ghost hover:bg-red-50 hover:text-red-700">
            Dismiss
          </button>
        )}
        
        {item.status === 'duplicate' && item.receiptId && (
          <Link to={`/receipts?id=${item.receiptId}`} className="btn-ghost text-orange-700 hover:bg-orange-50">
            View Original <ChevronRight size={16} />
          </Link>
        )}

        {(item.status === 'preprocessing' || item.status === 'duplicate-check' || item.status === 'extracting') && (
          <button 
            onClick={onCancel}
            aria-label={`Cancel processing ${item.originalName}`}
            className="btn-ghost"
          >
            Cancel
          </button>
        )}

        {item.status === 'retry-wait' && (
          <button onClick={onRetry} aria-label={`Retry ${item.originalName} now`} className="btn-ghost text-blue-700 hover:bg-blue-50">
            Retry now
          </button>
        )}

        {(item.status === 'queued' || item.status === 'failed-permanent' || item.status === 'retry-wait' || item.status === 'cancelled' || item.status === 'duplicate') && (
          <button 
            onClick={onRemove}
            aria-label={`Remove ${item.originalName} from the queue`}
            className="touch-target flex items-center justify-center rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-700"
          >
            <X size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
