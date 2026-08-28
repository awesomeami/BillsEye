import { useCallback, useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { getCroppedImg } from '../../../../utils/imageUtils';

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
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
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
            <span className="text-sm font-medium">Zoom</span>
            <input
            type="range"
            value={zoom}
            min={1}
            max={3}
            step={0.1}
            aria-labelledby="Zoom"
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-1/2"
            />
        </div>
        <div className="flex justify-between items-center px-4">
            <span className="text-sm font-medium">Rotation</span>
            <input
            type="range"
            value={rotation}
            min={0}
            max={360}
            step={1}
            aria-labelledby="Rotation"
            onChange={(e) => setRotation(Number(e.target.value))}
            className="w-1/2"
            />
        </div>
        
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancel</button>
          <button 
            onClick={handleSave} 
            disabled={processing}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {processing ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
