import React, { useRef } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useDialogA11y } from './useDialogA11y';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDestructive?: boolean;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  isDestructive = false,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogA11y<HTMLDivElement>({ isOpen, onClose: onCancel, initialFocusRef: cancelButtonRef });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <div ref={dialogRef} role="alertdialog" tabIndex={-1} aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message" className="w-full max-w-sm rounded-md border border-gray-200 bg-white p-6 shadow-xl">
        <div className="flex justify-between items-start mb-4">
          <div className={`p-2 rounded-full ${isDestructive ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
            <AlertCircle size={24} />
          </div>
          <button onClick={onCancel} aria-label="Close confirmation" className="touch-target text-gray-500 hover:text-gray-700 transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <h3 id="confirm-dialog-title" className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
        <p id="confirm-dialog-message" className="text-sm text-gray-500 mb-6">{message}</p>
        
        <div className="flex gap-3 w-full">
          <button
            ref={cancelButtonRef}
            onClick={onCancel}
            className="touch-target flex-1 bg-white border border-gray-300 text-gray-700 font-medium py-2.5 px-4 rounded-xl hover:bg-gray-50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`touch-target flex-1 font-medium py-2.5 px-4 rounded-xl text-white transition-colors ${
              isDestructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
