import React, { useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, KeyRound, Plus, Trash2, XCircle } from 'lucide-react';
import { useAiKeys } from './AiKeysContext';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/Toast';
import { useDialogA11y } from '../../../components/ui/useDialogA11y';

export function AiKeysSettings({ onBack }: { onBack: () => void }) {
  const {
    slots,
    legacySlotIds,
    clearLegacyKeys,
    setKey,
    removeKey,
    toggleKey,
  } = useAiKeys();
  const { showToast } = useToast();

  const [editingSlotId, setEditingSlotId] = useState<number | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const editCancelRef = useRef<HTMLButtonElement>(null);
  const editDialogRef = useDialogA11y<HTMLDivElement>({
    isOpen: editingSlotId !== null,
    onClose: () => {
      setEditingSlotId(null);
      setNewKey('');
      setNewLabel('');
    },
    initialFocusRef: editCancelRef,
  });

  const closeEditor = () => {
    setEditingSlotId(null);
    setNewKey('');
    setNewLabel('');
  };

  const handleSaveKey = async () => {
    if (!newKey || editingSlotId === null) return;
    try {
      await setKey(editingSlotId, newKey, newLabel || `Key ${editingSlotId}`);
      closeEditor();
      showToast('Key saved in this browser for this account.', 'success');
    } catch {
      showToast('Could not save the key in this browser. Please try again.', 'error');
    }
  };

  const nextAvailableSlot = () => {
    for (let slotId = 1; slotId <= 5; slotId += 1) {
      if (!slots.find(slot => slot.slotId === slotId)) return slotId;
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <header className="pb-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} aria-label="Back to settings" className="touch-target p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">AI Configuration</h2>
            <p className="text-xs text-gray-500">Local keys, round-robin rotation</p>
          </div>
        </div>
      </header>

      <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex gap-3 text-sm text-blue-800">
        <InfoIcon className="shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Saved only in this browser</p>
          <p className="mt-1 opacity-90">
            Add a key once and it stays available after reloads for this account on this browser. Keys are never synchronized to Firestore.
          </p>
        </div>
      </div>

      {legacySlotIds.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl text-sm text-amber-900 space-y-3">
          <p className="font-medium">Keys from the earlier passphrase version need to be entered once more.</p>
          <p>That version cannot be read without its old passphrase. Replace each listed slot to save it with the new browser-local setup, or remove the old reminders.</p>
          <button onClick={() => {
            if (window.confirm('Remove all old key reminders on this browser?')) {
              void clearLegacyKeys()
                .then(() => showToast('Old key reminders removed.', 'success'))
                .catch(() => showToast('Could not remove old key reminders.', 'error'));
            }
          }} className="touch-target px-3 py-2 border border-amber-300 rounded-lg hover:bg-amber-100">
            Remove old reminders
          </button>
        </div>
      )}

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
                  <div className="flex items-center gap-2 mt-2 text-xs font-medium">
                    {slot.status === 'healthy' && <span className="text-green-600 flex items-center gap-1"><CheckCircle2 size={14} />Healthy</span>}
                    {slot.status === 'cooldown' && <span className="text-orange-600 flex items-center gap-1"><Clock size={14} />Cooldown</span>}
                    {slot.status === 'invalid' && <span className="text-red-600 flex items-center gap-1"><XCircle size={14} />Invalid</span>}
                    {slot.status === 'untested' && <span className="text-gray-500 flex items-center gap-1"><AlertTriangle size={14} />Ready</span>}
                    {slot.requiresMigration && <span className="ml-2 bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Re-enter key</span>}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label className="touch-target flex items-center cursor-pointer mr-2" aria-label={`${slot.isEnabled ? 'Disable' : 'Enable'} ${slot.label}`}>
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={slot.isEnabled}
                      disabled={slot.requiresMigration}
                      onChange={event => void toggleKey(slot.slotId, event.target.checked)}
                    />
                    <div className={`block w-10 h-6 rounded-full transition-colors ${slot.isEnabled ? 'bg-blue-600' : 'bg-gray-300'}`} />
                    <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${slot.isEnabled ? 'transform translate-x-4' : ''}`} />
                  </div>
                </label>

                <button onClick={() => {
                  setEditingSlotId(slot.slotId);
                  setNewKey('');
                  setNewLabel(slot.label || '');
                }} aria-label={`Replace ${slot.label}`} className="touch-target p-2 text-gray-500 hover:text-blue-700 transition-colors" title="Replace Key">
                  <KeyRound size={18} />
                </button>
                <button onClick={() => setConfirmDeleteId(slot.slotId)} aria-label={`Remove ${slot.label}`} className="touch-target p-2 text-gray-500 hover:text-red-700 transition-colors" title="Remove Key">
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {slots.length < 5 && (
          <button
            onClick={() => {
              const slotId = nextAvailableSlot();
              if (slotId !== null) {
                setEditingSlotId(slotId);
                setNewKey('');
                setNewLabel('');
              }
            }}
            className="touch-target w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed border-gray-300 rounded-2xl text-gray-600 hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            <Plus size={20} />
            <span className="font-medium">Add Key (Slot {nextAvailableSlot()})</span>
          </button>
        )}
      </div>

      {editingSlotId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
          <div ref={editDialogRef} role="dialog" aria-modal="true" aria-labelledby="key-dialog-title" tabIndex={-1} className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 id="key-dialog-title" className="text-lg font-bold text-gray-900 mb-4">Slot {editingSlotId} Configuration</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="key-label" className="block text-sm font-medium text-gray-700 mb-1">Key Label (Optional)</label>
                <input
                  id="key-label"
                  type="text"
                  placeholder="e.g. Personal Gemini Key"
                  value={newLabel}
                  onChange={event => setNewLabel(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label htmlFor="gemini-api-key" className="block text-sm font-medium text-gray-700">Gemini API Key</label>
                  <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                    Get API Key
                  </a>
                </div>
                <input
                  id="gemini-api-key"
                  type="password"
                  placeholder="AIza..."
                  value={newKey}
                  onChange={event => setNewKey(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                />
                <p className="text-xs text-gray-500 mt-2">Saved only in this browser for the current account. No passphrase is required.</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button ref={editCancelRef} onClick={closeEditor} className="touch-target flex-1 px-4 py-2 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => void handleSaveKey()}
                disabled={!newKey}
                className="touch-target flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50"
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
        message="Are you sure you want to remove this key? It will be deleted from this browser."
        isDestructive={true}
        confirmText="Remove"
        onConfirm={() => {
          if (confirmDeleteId !== null) void removeKey(confirmDeleteId);
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
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
