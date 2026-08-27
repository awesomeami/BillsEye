import React, { useState } from 'react';
import { FileText, X } from 'lucide-react';

interface Props {
  file: File;
  totalPages: number;
  onConfirm: (pages: number[]) => void;
  onCancel: () => void;
}

export function PdfPageSelector({ file, totalPages, onConfirm, onCancel }: Props) {
  const [selectedPages, setSelectedPages] = useState<string>('1');
  const [error, setError] = useState('');

  const handleConfirm = () => {
    const pages = new Set<number>();
    const parts = selectedPages.split(',');
    
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      
      if (trimmed.includes('-')) {
        const [start, end] = trimmed.split('-').map(s => parseInt(s.trim()));
        if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
          setError(`Invalid range: ${trimmed}`);
          return;
        }
        for (let i = start; i <= end; i++) pages.add(i);
      } else {
        const page = parseInt(trimmed);
        if (isNaN(page) || page < 1 || page > totalPages) {
          setError(`Invalid page: ${trimmed}`);
          return;
        }
        pages.add(page);
      }
    }
    
    const pageArray = Array.from(pages).sort((a, b) => a - b);
    if (pageArray.length === 0) {
      setError('Please select at least one page.');
      return;
    }
    
    if (pageArray.length > 20) {
      setError('Maximum 20 pages allowed at once.');
      return;
    }
    
    onConfirm(pageArray);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-gray-100 bg-gray-50/50">
          <h2 className="font-semibold flex items-center gap-2">
            <FileText size={18} className="text-gray-500" />
            Select PDF Pages
          </h2>
          <button onClick={onCancel} className="text-gray-400 hover:bg-gray-100 p-1.5 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-gray-900 mb-1">{file.name}</p>
            <p className="text-xs text-gray-500">This document has {totalPages} pages.</p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Pages to Extract (max 20)
            </label>
            <input 
              type="text" 
              value={selectedPages}
              onChange={(e) => { setSelectedPages(e.target.value); setError(''); }}
              placeholder="e.g. 1, 3-5"
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm"
              autoFocus
            />
            {error ? (
              <p className="text-sm text-red-600 mt-1">{error}</p>
            ) : (
              <p className="text-xs text-gray-500 mt-1">
                Enter page numbers or ranges separated by commas.
              </p>
            )}
          </div>
        </div>
        
        <div className="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/50">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">
            Cancel
          </button>
          <button onClick={handleConfirm} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
            Process Pages
          </button>
        </div>
      </div>
    </div>
  );
}
