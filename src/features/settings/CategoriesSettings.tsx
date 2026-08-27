import React, { useState, useEffect } from 'react';
import { useToast } from '../../components/ui/Toast';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ChevronRight, Plus, Trash2, Edit2, Check, X, GripVertical, AlertTriangle } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { categoryRepository, receiptRepository } from '../../services/firebase/db';
import { CategoryDocument, ReceiptDocument } from '../../domain/schema';

export function CategoriesSettings({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
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
  const [usageCount, setUsageCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    const unsub = categoryRepository.subscribeToCategories(user.uid, (data) => {
      setCategories(data.sort((a, b) => a.order - b.order));
      setLoading(false);
    }, (err) => {
      setError(err.message);
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  const handleAdd = async () => {
    if (!user || !newName.trim()) return;
    try {
      await categoryRepository.addCategory(user.uid, newName.trim(), true);
      setNewName('');
      setIsAdding(false);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!user || !editName.trim()) return;
    await categoryRepository.updateCategory(user.uid, id, { name: editName.trim() });
    setEditingId(null);
  };

  const toggleActive = async (cat: CategoryDocument) => {
    if (!user || !cat.isCustom) return; // cannot deactivate defaults based on typical rules, or maybe we can? The prompt says "deactivate custom categories"
    await categoryRepository.updateCategory(user.uid, cat.id, { isActive: !cat.isActive });
  };

  const checkUsageAndPromptDelete = async (cat: CategoryDocument) => {
    if (!user) return;
    if (!cat.isCustom) return; // cannot delete defaults

    // Check if category is in use
    const allReceipts = await receiptRepository.getReceipts(user.uid);
    let count = 0;
    allReceipts.forEach(r => {
      r.items.forEach(i => {
        if (i.category === cat.name) count++;
      });
    });

    if (count > 0) {
      setUsageCount(count);
      setDeletingCategory(cat);
      setReplacementCategory(categories.find(c => c.id !== cat.id)?.name || '');
    } else {
      setConfirmAction({
        message: `Delete category "${cat.name}"?`,
        action: async () => {
          try {
            await categoryRepository.deleteCategory(user.uid, cat.id);
            showToast("Category deleted", "success");
          } catch (e: any) {
            showToast("Failed to delete category: " + e.message, "error");
          }
        }
      });
    }
  };

  const confirmDeleteWithReplacement = async () => {
    if (!user || !deletingCategory || !replacementCategory) return;
    
    // 1. Update all receipts using this category
    const allReceipts = await receiptRepository.getReceipts(user.uid);
    for (const r of allReceipts) {
      let changed = false;
      const newItems = r.items.map(item => {
        if (item.category === deletingCategory.name) {
          changed = true;
          return { ...item, category: replacementCategory };
        }
        return item;
      });
      if (changed) {
        await receiptRepository.updateReceipt(user.uid, r.id, { items: newItems, wasEditedByUser: true });
      }
    }

    // 2. Delete the category
    await categoryRepository.deleteCategory(user.uid, deletingCategory.id);
    setDeletingCategory(null);
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
            <h2 className="text-xl font-bold text-gray-900">Custom Categories</h2>
            <p className="text-xs text-gray-500">Manage categories used for receipts</p>
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
          
          {categories.map((cat, idx) => (
            <li key={cat.id} className={`p-4 flex items-center justify-between hover:bg-gray-50 group ${!cat.isActive ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-3 flex-1">
                <GripVertical size={16} className="text-gray-300 cursor-grab" />
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
                    {cat.isCustom && (
                      <button 
                        onClick={() => toggleActive(cat)} 
                        className="text-xs px-2 py-1 mr-2 text-gray-500 hover:bg-gray-100 rounded border border-gray-200"
                      >
                        {cat.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                    <button 
                      onClick={() => { setEditingId(cat.id); setEditName(cat.name); }} 
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Rename"
                      title="Rename"
                    >
                      <Edit2 size={16}/>
                    </button>
                    {cat.isCustom && (
                      <button 
                        onClick={() => checkUsageAndPromptDelete(cat)} 
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Delete"
                        title="Delete"
                      >
                        <Trash2 size={16}/>
                      </button>
                    )}
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
                The category <strong>{deletingCategory.name}</strong> is currently used by {usageCount} item(s).
                To delete it, you must select a replacement category for these items.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Replacement Category</label>
                <select 
                  className="w-full border border-gray-300 rounded-lg p-2"
                  value={replacementCategory}
                  onChange={e => setReplacementCategory(e.target.value)}
                >
                  {categories.filter(c => c.id !== deletingCategory.id).map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
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
                className="px-4 py-2 font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                Replace & Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
