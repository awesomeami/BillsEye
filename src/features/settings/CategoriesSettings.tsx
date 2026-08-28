import React, { useEffect, useRef, useState } from 'react';
import { useToast } from '../../components/ui/Toast';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ChevronRight, Plus, Trash2, Edit2, Check, X, AlertTriangle } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { categoryRepository } from '../../services/firebase/db';
import { CategoryDocument } from '../../domain/schema';
import { ActiveSessionGuard, SessionScope } from '../../services/firebase/subscriptionIsolation';

export function CategoriesSettings({ onBack }: { onBack: () => void }) {
  const { user, sessionEpoch } = useAuth();
  const userId = user?.uid ?? null;
  const sessionGuardRef = useRef(new ActiveSessionGuard());
  const sessionScopeRef = useRef<SessionScope | null>(null);
  const { showToast } = useToast();
  const [confirmAction, setConfirmAction] = useState<{ message: string, action: () => void } | null>(null);
  const [categories, setCategories] = useState<CategoryDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');

  // Delete modal state
  const [deletingCategory, setDeletingCategory] = useState<CategoryDocument | null>(null);
  const [replacementCategory, setReplacementCategory] = useState<string>('');
  const [referenceCounts, setReferenceCounts] = useState({ receiptItems: 0, aliases: 0 });

  useEffect(() => {
    const sessionGuard = sessionGuardRef.current;
    sessionGuard.invalidate();
    sessionScopeRef.current = null;
    setCategories([]);
    setLoading(Boolean(userId));
    setError('');
    setConfirmAction(null);
    setEditingId(null);
    setEditName('');
    setIsAdding(false);
    setNewName('');
    setDeletingCategory(null);
    setReplacementCategory('');
    setReferenceCounts({ receiptItems: 0, aliases: 0 });
    if (!userId) return;
    const scope = sessionGuard.activate(userId);
    sessionScopeRef.current = scope;
    const unsub = categoryRepository.subscribeToCategories(userId, (data) => {
      if (!sessionGuard.isActive(scope)) return;
      setCategories([...data].sort((a, b) => a.order - b.order));
      setLoading(false);
    }, (err) => {
      if (!sessionGuard.isActive(scope)) return;
      setError(err.message);
      setLoading(false);
    });
    return () => {
      sessionGuard.invalidate(scope);
      if (sessionScopeRef.current === scope) sessionScopeRef.current = null;
      unsub();
    };
  }, [sessionEpoch, userId]);

  const isCurrentUser = (uid: string) => {
    const scope = sessionScopeRef.current;
    return Boolean(scope && scope.uid === uid && sessionGuardRef.current.isActive(scope));
  };

  const handleAdd = async () => {
    if (!user || !newName.trim()) return;
    const uid = user.uid;
    try {
      await categoryRepository.addCategory(uid, newName.trim(), true);
      if (!isCurrentUser(uid)) return;
      setNewName('');
      setIsAdding(false);
      setError('');
    } catch (addError: unknown) {
      if (!isCurrentUser(uid)) return;
      setError(addError instanceof Error ? addError.message : 'Could not create category.');
    }
  };

  const handleUpdate = async (id: string) => {
    if (!user || !editName.trim()) return;
    const uid = user.uid;
    try {
      await categoryRepository.renameCategory(uid, id, editName.trim());
      if (!isCurrentUser(uid)) return;
      setEditingId(null);
    } catch (renameError: unknown) {
      if (!isCurrentUser(uid)) return;
      setError(renameError instanceof Error ? renameError.message : 'Could not rename category.');
    }
  };

  const toggleActive = async (cat: CategoryDocument) => {
    if (!user) return;
    await categoryRepository.updateCategory(user.uid, cat.id, { isActive: !cat.isActive });
  };

  const checkUsageAndPromptDelete = async (cat: CategoryDocument) => {
    if (!user) return;
    const uid = user.uid;
    const counts = await categoryRepository.getReferenceCounts(uid, cat);
    if (!isCurrentUser(uid)) return;
    if (counts.receiptItems > 0 || counts.aliases > 0) {
      setReferenceCounts(counts);
      setDeletingCategory(cat);
      setReplacementCategory(categories.find(category => category.id !== cat.id && category.isActive)?.id || '');
    } else {
      setConfirmAction({
        message: `Delete category "${cat.name}"?`,
        action: async () => {
          try {
            await categoryRepository.deleteCategory(uid, cat.id);
            if (!isCurrentUser(uid)) return;
            showToast("Category deleted", "success");
          } catch (deleteError: unknown) {
            if (!isCurrentUser(uid)) return;
            showToast(`Failed to delete category: ${deleteError instanceof Error ? deleteError.message : 'Unknown error'}`, 'error');
          }
        }
      });
    }
  };

  const confirmDeleteWithReplacement = async () => {
    if (!user || !deletingCategory || !replacementCategory) return;
    const uid = user.uid;
    
    // 1. Update all receipts using this category
    try {
      await categoryRepository.replaceCategory(uid, deletingCategory.id, replacementCategory);
      if (!isCurrentUser(uid)) return;
      setDeletingCategory(null);
      showToast('Category references were moved and the old category was deleted.', 'success');
    } catch (replaceError: unknown) {
      if (!isCurrentUser(uid)) return;
      setError(replaceError instanceof Error ? replaceError.message : 'Could not replace this category safely.');
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      <header className="pb-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} aria-label="Back" className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <ChevronRight className="rotate-180" size={20} />
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Categories</h2>
            <p className="text-xs text-gray-500">Manage the categories used for receipt items.</p>
          </div>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="bg-blue-50 text-blue-600 p-2 rounded-lg hover:bg-blue-100 flex items-center gap-1 text-sm font-medium"
        >
          <Plus size={16} /> Add
        </button>
      </header>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <ul className="divide-y divide-gray-200">
          {isAdding && (
            <li className="p-4 flex items-center gap-3 bg-blue-50/50">
              <input 
                autoFocus
                type="text"
                placeholder="Category name..."
                className="flex-1 border border-blue-200 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
              <button onClick={handleAdd} aria-label="Confirm Add" className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"><Check size={18}/></button>
              <button onClick={() => setIsAdding(false)} aria-label="Cancel Add" className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"><X size={18}/></button>
            </li>
          )}
          
          {categories.map(cat => (
            <li key={cat.id} className={`p-4 flex items-center justify-between hover:bg-gray-50 group ${!cat.isActive ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-3 flex-1">
                {editingId === cat.id ? (
                  <input
                    autoFocus
                    type="text"
                    className="flex-1 border border-gray-300 rounded-lg p-1.5 text-sm"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleUpdate(cat.id)}
                  />
                ) : (
                  <span className="font-medium text-gray-900 text-sm">
                    {cat.name} 
                    {!cat.isCustom && <span className="ml-2 text-[10px] uppercase bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Default</span>}
                  </span>
                )}
              </div>
              
              <div className="flex items-center gap-1 transition-opacity focus-within:opacity-100 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                {editingId === cat.id ? (
                  <>
                    <button onClick={() => handleUpdate(cat.id)} aria-label="Confirm Edit" className="p-2 text-blue-600 hover:bg-blue-50 rounded min-w-[44px] min-h-[44px] flex items-center justify-center"><Check size={16}/></button>
                    <button onClick={() => setEditingId(null)} aria-label="Cancel Edit" className="p-2 text-gray-400 hover:bg-gray-100 rounded min-w-[44px] min-h-[44px] flex items-center justify-center"><X size={16}/></button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => toggleActive(cat)}
                      className="text-xs px-2 py-1 mr-2 text-gray-500 hover:bg-gray-100 rounded border border-gray-200"
                    >
                      {cat.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button 
                      onClick={() => { setEditingId(cat.id); setEditName(cat.name); }} 
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Rename"
                      title="Rename"
                    >
                      <Edit2 size={16}/>
                    </button>
                    <button
                      onClick={() => checkUsageAndPromptDelete(cat)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Delete"
                      title="Delete"
                    >
                      <Trash2 size={16}/>
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {deletingCategory && (
        <div role="dialog" aria-modal="true" aria-labelledby="category-delete-title" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-200">
              <h2 id="category-delete-title" className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <AlertTriangle className="text-amber-500" size={20} />
                Category in Use
              </h2>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <p>
                The category <strong>{deletingCategory.name}</strong> is used by {referenceCounts.receiptItems} receipt item(s)
                {referenceCounts.aliases > 0 && ` and ${referenceCounts.aliases} merchant alias(es)`}. Choose a replacement before deleting it.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Replacement Category</label>
                <select 
                  className="w-full border border-gray-300 rounded-lg p-2"
                  value={replacementCategory}
                  onChange={e => setReplacementCategory(e.target.value)}
                >
                  {categories.filter(category => category.id !== deletingCategory.id && category.isActive).map(category => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3 bg-gray-50">
              <button 
                onClick={() => setDeletingCategory(null)}
                className="px-4 py-2 font-medium text-gray-600 hover:bg-gray-200 rounded-lg"
              >
                Cancel
              </button>
              <button 
                onClick={confirmDeleteWithReplacement}
                disabled={!replacementCategory}
                className="px-4 py-2 font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                Replace & Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmAction !== null}
        title="Delete Category"
        message={confirmAction?.message || ''}
        confirmText="Delete"
        isDestructive={true}
        onConfirm={() => {
          if (confirmAction) void confirmAction.action();
          setConfirmAction(null);
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
