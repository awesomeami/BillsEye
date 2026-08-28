import { useCallback, useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { getCroppedImg } from '../../../../utils/imageUtils';
import { useDialogA11y } from '../../../../components/ui/useDialogA11y';

interface Props {
  imageSrc: string;
  onSave: (blob: Blob) => void;
  onCancel: () => void;
}

export function ReceiptCropper({ imageSrc, onSave, onCancel }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [processing, setProcessing] = useState(false);
  const mountedRef = useRef(true);
  const activeImageSrcRef = useRef(imageSrc);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogA11y<HTMLDivElement>({ isOpen: true, onClose: onCancel, initialFocusRef: cancelButtonRef });
  activeImageSrcRef.current = imageSrc;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onCropComplete = useCallback((croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels) return;
    const source = imageSrc;
    setProcessing(true);
    try {
      const croppedBlob = await getCroppedImg(source, croppedAreaPixels, rotation);
      if (!mountedRef.current || activeImageSrcRef.current !== source) return;
      onSave(croppedBlob);
    } catch {
      console.error('Failed to crop receipt image.');
    } finally {
      if (mountedRef.current && activeImageSrcRef.current === source) setProcessing(false);
    }
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="receipt-cropper-title" tabIndex={-1} className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      <h2 id="receipt-cropper-title" className="sr-only">Crop receipt image</h2>
      <div className="relative flex-1">
        <Cropper
          image={imageSrc}
          crop={crop}
          rotation={rotation}
          zoom={zoom}
          aspect={undefined} // free aspect ratio
          onCropChange={setCrop}
          onRotationChange={setRotation}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>
      <div className="bg-white p-4 shrink-0 flex flex-col gap-4">
        <div className="flex justify-between items-center px-4">
            <label htmlFor="crop-zoom" className="text-sm font-medium">Zoom</label>
            <input
            id="crop-zoom"
            type="range"
            value={zoom}
            min={1}
            max={3}
            step={0.1}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-1/2"
            />
        </div>
        <div className="flex justify-between items-center px-4">
            <label htmlFor="crop-rotation" className="text-sm font-medium">Rotation</label>
            <input
            id="crop-rotation"
            type="range"
            value={rotation}
            min={0}
            max={360}
            step={1}
            onChange={(e) => setRotation(Number(e.target.value))}
            className="w-1/2"
            />
        </div>
        
        <div className="flex justify-end gap-3 pt-2">
          <button ref={cancelButtonRef} onClick={onCancel} className="touch-target px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancel</button>
          <button 
            onClick={handleSave} 
            disabled={processing}
            className="touch-target px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {processing ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
