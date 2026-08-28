import React, { useRef, useState, useEffect } from 'react';
import { useToast } from '../../components/ui/Toast';
import { Camera, Image as ImageIcon, FileText, Upload, X, RotateCw, Crop, CheckCircle2, AlertCircle, Clock, Search, ChevronRight, Slash } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useReceiptQueue } from '../receipts/queue/ReceiptQueueContext';
import { QueueItem, isRetryableQueueStatus } from '../receipts/queue/queueReducer';
import { ReceiptCropper } from '../receipts/queue/components/ReceiptCropper';
import { PdfPageSelector } from './PdfPageSelector';
import { PdfSelectionRequest, preparePdfSelections } from './pdfSelectionQueue';

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
    <div className="max-w-2xl mx-auto space-y-6 pb-24">
      <header className="pb-4 border-b border-gray-200">
        <h1 className="text-2xl font-bold text-gray-900">Add Receipts</h1>
        <p className="text-sm text-gray-500 mt-1">Upload images or PDFs to extract data automatically.</p>
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
          <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex gap-3 text-blue-800 text-sm">
            <div className="mt-0.5 shrink-0"><Upload size={18} /></div>
            <div>
              <p className="font-medium">Privacy & Memory Notice</p>
              <p className="text-blue-700/80 mt-1">
                Images are processed in memory only to protect your privacy. Original files are never saved permanently. Refreshing or closing the browser permanently drops queued uploads and temporary review images; a receipt already saved for review remains in your Inbox, but its image may need to be reattached. We do not support HEIC formats natively—please convert to JPG/PNG first.
              </p>
            </div>
          </div>
          
          <button 
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-col items-center justify-center p-8 bg-white border-2 border-dashed border-gray-300 rounded-2xl hover:bg-gray-50 hover:border-blue-500 transition-colors group h-64 shadow-sm"
          >
            <div className="bg-blue-100 p-4 rounded-full group-hover:bg-blue-200 transition-colors mb-4">
              <Camera size={40} className="text-blue-700" />
            </div>
            <span className="text-lg font-medium text-gray-900">Take a Photo</span>
            <span className="text-sm text-gray-500 mt-1">Use your device's rear camera</span>
          </button>
          
          <div className="grid grid-cols-2 gap-4">
            <button 
              onClick={() => imageInputRef.current?.click()}
              className="flex flex-col items-center justify-center p-6 bg-white border border-gray-200 rounded-2xl hover:bg-gray-50 transition-colors shadow-sm cursor-pointer"
            >
              <div className="bg-gray-100 p-3 rounded-full mb-3">
                <ImageIcon size={24} className="text-gray-700" />
              </div>
              <span className="font-medium text-gray-900">Photo Library</span>
              <span className="text-xs text-gray-500 mt-1 text-center">JPG, PNG, WebP or Multiple</span>
            </button>
            
            <button 
              onClick={() => pdfInputRef.current?.click()}
              className="flex flex-col items-center justify-center p-6 bg-white border border-gray-200 rounded-2xl hover:bg-gray-50 transition-colors shadow-sm cursor-pointer"
            >
              <div className="bg-gray-100 p-3 rounded-full mb-3">
                <FileText size={24} className="text-gray-700" />
              </div>
              <span className="font-medium text-gray-900">Upload PDF</span>
              <span className="text-xs text-gray-500 mt-1 text-center">Renders locally</span>
            </button>
          </div>
          <div className="text-center text-sm text-gray-400 mt-2">
             Or drag and drop files anywhere here
          </div>
        </div>
      ) : (
        <div className="space-y-4">
           <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-200">
             <div>
               <h3 className="font-bold text-gray-900">Processing Queue ({items.length})</h3>
               <p className="text-sm text-gray-500">You can navigate elsewhere while processing continues. Refreshing or closing the browser loses queued files and temporary review images.</p>
             </div>
             <div className="flex gap-2">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 cursor-pointer"
                >
                  Add More
                </button>
                {items.some(i => isRetryableQueueStatus(i.status)) && (
                  <button 
                    onClick={retryScheduled}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 cursor-pointer"
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

  return (
    <div className="flex bg-white rounded-xl border border-gray-200 p-3 shadow-sm items-center gap-4 group">
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
             className="absolute bottom-1 right-1 p-1 bg-black/60 text-white rounded hover:bg-black/80 transition-colors"
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
         {item.error && <p className="text-xs text-red-600 mt-1 truncate">{item.error}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {item.status === 'needs-review' && item.receiptId && (
          <Link to={`/receipts/${item.receiptId}/review`} onClick={onReview} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg flex items-center gap-1 text-sm font-medium">
            Review <ChevronRight size={16} />
          </Link>
        )}

        {item.status === 'needs-review' && (
          <button onClick={onRemove} aria-label={`Dismiss ${item.originalName} from the queue`} className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium">
            Dismiss
          </button>
        )}
        
        {item.status === 'duplicate' && item.receiptId && (
          <Link to={`/receipts?id=${item.receiptId}`} className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg flex items-center gap-1 text-sm font-medium">
            View Original <ChevronRight size={16} />
          </Link>
        )}

        {(item.status === 'preprocessing' || item.status === 'duplicate-check' || item.status === 'extracting') && (
          <button 
            onClick={onCancel}
            aria-label={`Cancel processing ${item.originalName}`}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors text-sm font-medium"
          >
            Cancel
          </button>
        )}

        {item.status === 'retry-wait' && (
          <button onClick={onRetry} aria-label={`Retry ${item.originalName} now`} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg text-sm font-medium">
            Retry now
          </button>
        )}

        {(item.status === 'queued' || item.status === 'failed-permanent' || item.status === 'retry-wait' || item.status === 'cancelled' || item.status === 'duplicate') && (
          <button 
            onClick={onRemove}
            aria-label={`Remove ${item.originalName} from the queue`}
            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
