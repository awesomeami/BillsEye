import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { aliasRepository } from '../../services/firebase/db';
import { AliasDocument } from '../../domain/schema';
import { useReceiptsLibrary } from '../receipts/library/ReceiptsLibraryContext';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { ActiveSessionGuard, SessionScope } from '../../services/firebase/subscriptionIsolation';

export function MerchantAliasesSettings({ onBack }: { onBack: () => void }) {
  const { user, sessionEpoch } = useAuth();
  const userId = user?.uid ?? null;
  const sessionGuardRef = useRef(new ActiveSessionGuard());
  const sessionScopeRef = useRef<SessionScope | null>(null);
  const { categories } = useReceiptsLibrary();
  const { showToast } = useToast();
  const [aliases, setAliases] = useState<AliasDocument[]>([]);
  const [merchant, setMerchant] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [aliasToDelete, setAliasToDelete] = useState<AliasDocument | null>(null);

  const activeCategories = useMemo(
    () => categories.filter(category => category.isActive),
    [categories],
  );

  useEffect(() => {
    const sessionGuard = sessionGuardRef.current;
    sessionGuard.invalidate();
    sessionScopeRef.current = null;
    setAliases([]);
    setMerchant('');
    setCategoryId('');
    setSaving(false);
    setError('');
    setAliasToDelete(null);
    if (!userId) return;
    const scope = sessionGuard.activate(userId);
    sessionScopeRef.current = scope;
    const unsubscribe = aliasRepository.subscribeToAliases(userId, data => {
      if (sessionGuard.isActive(scope)) setAliases(data);
    }, aliasError => {
      if (!sessionGuard.isActive(scope)) return;
      setError(aliasError.message || 'Could not load merchant aliases.');
    });
    return () => {
      sessionGuard.invalidate(scope);
      if (sessionScopeRef.current === scope) sessionScopeRef.current = null;
      unsubscribe();
    };
  }, [sessionEpoch, userId]);

  const isCurrentUser = (uid: string) => {
    const scope = sessionScopeRef.current;
    return Boolean(scope && scope.uid === uid && sessionGuardRef.current.isActive(scope));
  };

  useEffect(() => {
    if (!categoryId && activeCategories.length > 0) {
      setCategoryId(activeCategories[0].id);
    }
  }, [activeCategories, categoryId]);

  const saveAlias = async () => {
    if (!user || !merchant.trim() || !categoryId) return;
    const uid = user.uid;
    setSaving(true);
    setError('');
    try {
      await aliasRepository.setAlias(uid, merchant, categoryId);
      if (!isCurrentUser(uid)) return;
      setMerchant('');
      showToast('Merchant alias saved.', 'success');
    } catch (saveError: unknown) {
      if (!isCurrentUser(uid)) return;
      setError(saveError instanceof Error ? saveError.message : 'Could not save this alias.');
    } finally {
      if (isCurrentUser(uid)) setSaving(false);
    }
  };

  const deleteAlias = async () => {
    if (!user || !aliasToDelete) return;
    const uid = user.uid;
    try {
      await aliasRepository.deleteAlias(uid, aliasToDelete.id);
      if (!isCurrentUser(uid)) return;
      showToast('Merchant alias deleted.', 'success');
    } catch (deleteError: unknown) {
      if (!isCurrentUser(uid)) return;
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this alias.');
    } finally {
      if (isCurrentUser(uid)) setAliasToDelete(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="pb-4 border-b border-gray-200 flex items-center gap-4">
        <button onClick={onBack} aria-label="Back" className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500 min-w-[44px] min-h-[44px] flex items-center justify-center">
          <ChevronRight className="rotate-180" size={20} />
        </button>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Merchant Aliases</h2>
          <p className="text-xs text-gray-500">Set a review-time default category for an exact merchant name.</p>
        </div>
      </header>

      <div className="bg-blue-50 border border-blue-100 text-sm text-blue-900 rounded-xl p-4">
        An alias fills the category for unedited line items when a receipt from that merchant is opened for review. It never changes an already confirmed receipt or overwrites a human edit.
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 space-y-3">
        <label className="block text-sm font-medium text-gray-700" htmlFor="merchant-alias-name">Merchant name</label>
        <input
          id="merchant-alias-name"
          value={merchant}
          onChange={event => setMerchant(event.target.value)}
          placeholder="For example: Example Market"
          className="w-full border border-gray-300 rounded-lg p-2 text-sm"
        />
        <label className="block text-sm font-medium text-gray-700" htmlFor="merchant-alias-category">Default category</label>
        <select
          id="merchant-alias-category"
          value={categoryId}
          onChange={event => setCategoryId(event.target.value)}
          className="w-full border border-gray-300 rounded-lg p-2 text-sm"
          disabled={activeCategories.length === 0}
        >
          {activeCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <button
          onClick={saveAlias}
          disabled={saving || !merchant.trim() || !categoryId}
          className="touch-target w-full flex justify-center items-center gap-2 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus size={16} /> {saving ? 'Saving…' : 'Save Alias'}
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {aliases.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">No merchant aliases yet.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {aliases.map(alias => {
              const category = categories.find(candidate => candidate.id === alias.categoryId);
              return (
                <li key={alias.id} className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-gray-900 truncate">{alias.merchantNormalized}</p>
                    <p className="text-xs text-gray-500">{category?.name ?? 'Deleted category'}</p>
                  </div>
                  <button onClick={() => setAliasToDelete(alias)} aria-label={`Delete alias for ${alias.merchantNormalized}`} className="touch-target p-2 text-gray-500 hover:text-red-700 hover:bg-red-50 rounded-lg">
                    <Trash2 size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        isOpen={aliasToDelete !== null}
        title="Delete Merchant Alias"
        message={aliasToDelete ? `Delete the alias for “${aliasToDelete.merchantNormalized}”?` : ''}
        confirmText="Delete"
        isDestructive={true}
        onConfirm={deleteAlias}
        onCancel={() => setAliasToDelete(null)}
      />
    </div>
  );
}
