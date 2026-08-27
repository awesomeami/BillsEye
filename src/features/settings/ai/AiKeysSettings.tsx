import React, { useState } from 'react';
import { Plus, Trash2, KeyRound, CheckCircle2, XCircle, Clock, AlertTriangle, ArrowLeft } from 'lucide-react';
import { useAiKeys } from './AiKeysContext';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/Toast';

export function AiKeysSettings({ onBack }: { onBack: () => void }) {
  const { slots, setKey, removeKey, toggleKey } = useAiKeys();
  const { showToast } = useToast();

  const [editingSlotId, setEditingSlotId] = useState<number | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [isSessionOnly, setIsSessionOnly] = useState(false);
  
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const handleSaveKey = async () => {
    if (!newKey || !editingSlotId) return;
    try {
      await setKey(editingSlotId, newKey, newLabel || `Key ${editingSlotId}`, isSessionOnly);
      setEditingSlotId(null);
      setNewKey('');
      setNewLabel('');
      showToast('Key saved successfully', 'success');
    } catch (err: any) {
      showToast('Failed to save key', 'error');
    }
  };

  const nextAvailableSlot = () => {
    for (let i = 1; i <= 5; i++) {
      if (!slots.find(s => s.slotId === i)) return i;
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <header className="pb-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">AI Configuration</h2>
            <p className="text-xs text-gray-500">Local keys, round-robin rotation</p>
          </div>
        </div>
      </header>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex gap-3 text-sm text-blue-800">
        <InfoIcon className="shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Device-Local Secrets</p>
          <p className="mt-1 opacity-90">
            Keys are strictly stored on this device in your browser. They are never synchronized to Firestore.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {slots.map(slot => (
          <div key={slot.slotId} className={`bg-white border rounded-2xl p-4 transition-colors ${!slot.isEnabled ? 'opacity-60 border-gray-200' : 'border-gray-300 shadow-sm'}`}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center font-bold text-sm text-gray-600">
                  {slot.slotId}
                </div>
                <div>
                  <h4 className="font-bold text-gray-900">{slot.label}</h4>
                  <p className="text-sm font-mono text-gray-500 mt-0.5">{slot.maskedKey}</p>
                  
                  {/* Status Indicator */}
                  <div className="flex items-center gap-2 mt-2 text-xs font-medium">
                    {slot.status === 'healthy' && <span className="text-green-600 flex items-center gap-1"><CheckCircle2 size={14}/> Healthy</span>}
                    {slot.status === 'cooldown' && <span className="text-orange-600 flex items-center gap-1"><Clock size={14}/> Cooldown</span>}
                    {slot.status === 'invalid' && <span className="text-red-600 flex items-center gap-1"><XCircle size={14}/> Invalid</span>}
                    {slot.status === 'untested' && <span className="text-gray-500 flex items-center gap-1"><AlertTriangle size={14}/> Ready</span>}
                    
                    {slot.isSessionOnly && <span className="ml-2 bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Session Only</span>}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center cursor-pointer mr-2">
                  <div className="relative">
                    <input 
                      type="checkbox" 
                      className="sr-only" 
                      checked={slot.isEnabled}
                      onChange={(e) => toggleKey(slot.slotId, e.target.checked)}
                    />
                    <div className={`block w-10 h-6 rounded-full transition-colors ${slot.isEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                    <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${slot.isEnabled ? 'transform translate-x-4' : ''}`}></div>
                  </div>
                </label>

                <button onClick={() => {
                  setEditingSlotId(slot.slotId);
                  setNewLabel(slot.label || '');
                }} className="p-2 text-gray-400 hover:text-blue-600 transition-colors" title="Replace Key">
                  <KeyRound size={18} />
                </button>
                <button onClick={() => setConfirmDeleteId(slot.slotId)} className="p-2 text-gray-400 hover:text-red-600 transition-colors" title="Remove Key">
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {slots.length < 5 && (
          <button 
            onClick={() => {
              const next = nextAvailableSlot();
              if (next) setEditingSlotId(next);
            }}
            className="w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed border-gray-300 rounded-2xl text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            <Plus size={20} />
            <span className="font-medium">Add Key (Slot {nextAvailableSlot()})</span>
          </button>
        )}
      </div>

      {/* Editing Modal */}
      {editingSlotId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Slot {editingSlotId} Configuration</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Key Label (Optional)</label>
                <input 
                  type="text" 
                  placeholder="e.g. Personal Gemini Key"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-sm font-medium text-gray-700">Gemini API Key</label>
                  <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                    Get API Key
                  </a>
                </div>
                <input 
                  type="password" 
                  placeholder="AIza..."
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="radio" 
                    name="storage" 
                    checked={!isSessionOnly}
                    onChange={() => setIsSessionOnly(false)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-900">Save on this Device</span>
                </label>
                <p className="text-xs text-gray-500 ml-6">Saved in local browser IndexedDB storage.</p>
                
                <label className="flex items-center gap-2 cursor-pointer mt-2">
                  <input 
                    type="radio" 
                    name="storage" 
                    checked={isSessionOnly}
                    onChange={() => setIsSessionOnly(true)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-900">Session Only</span>
                </label>
                <p className="text-xs text-gray-500 ml-6">Kept in memory. Cleared when you close the app or sign out.</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => {
                setEditingSlotId(null);
                setNewKey('');
              }} className="flex-1 px-4 py-2 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button 
                onClick={handleSaveKey}
                disabled={!newKey}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDeleteId !== null}
        title="Remove Key"
        message="Are you sure you want to remove this key? It will be deleted from local storage."
        isDestructive={true}
        confirmText="Remove"
        onConfirm={() => {
          if (confirmDeleteId) removeKey(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
  );
}
