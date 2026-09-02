import { useEffect, useState } from 'react';
import { ChevronRight, Save } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useReceiptsLibrary } from '../receipts/library/ReceiptsLibraryContext';
import { settingsRepository } from '../../services/firebase/db';
import { APP_CONFIG } from '../../utilities/config';
import { parseMajorToMinor } from '../../domain/money';
import { useToast } from '../../components/ui/Toast';

export function PreferencesScreen({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const { settings } = useReceiptsLibrary();
  const { showToast } = useToast();
  const [tolerance, setTolerance] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTolerance(((settings.discrepancyTolerance ?? 0) / 100).toFixed(2));
  }, [settings.discrepancyTolerance]);

  const savePreferences = async () => {
    if (!user) return;
    try {
      const discrepancyTolerance = parseMajorToMinor(tolerance || '0');
      if (discrepancyTolerance === null) throw new Error('Enter a valid tolerance.');
      if (discrepancyTolerance < 0) throw new Error('Tolerance cannot be negative.');
      setSaving(true);
      setError('');
      await settingsRepository.updateSettings(user.uid, { discrepancyTolerance });
      showToast('Preferences saved.', 'success');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save preferences.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="pb-4 border-b border-gray-200 flex items-center gap-4">
        <button onClick={onBack} aria-label="Back" className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500 min-w-[44px] min-h-[44px] flex items-center justify-center">
          <ChevronRight className="rotate-180" size={20} />
        </button>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Profile & Preferences</h2>
          <p className="text-xs text-gray-500">Your account details and receipt-review settings.</p>
        </div>
      </header>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 space-y-2">
        <h3 className="font-semibold text-gray-900">Profile</h3>
        <p className="text-sm text-gray-600">{user?.displayName || 'BillsEye user'}</p>
        <p className="text-sm text-gray-500">{user?.email}</p>
      </section>

      <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 space-y-3">
        <h3 className="font-semibold text-gray-900">Regional formatting</h3>
        <p className="text-sm text-gray-600">BillsEye currently uses one centralized PKR configuration so totals and reports stay consistent across devices.</p>
        <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-gray-500">Currency</dt><dd className="font-medium text-gray-900">{APP_CONFIG.currency}</dd>
          <dt className="text-gray-500">Locale</dt><dd className="font-medium text-gray-900">{APP_CONFIG.locale}</dd>
          <dt className="text-gray-500">Time zone</dt><dd className="font-medium text-gray-900">{APP_CONFIG.timeZone}</dd>
        </dl>
      </section>

      <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 space-y-3">
        <h3 className="font-semibold text-gray-900">Receipt review</h3>
        <label htmlFor="discrepancy-tolerance" className="block text-sm font-medium text-gray-700">Totals mismatch tolerance</label>
        <p className="text-xs text-gray-500">Mark a receipt as matched when its calculated and printed totals differ by no more than this amount.</p>
        <div className="flex gap-3 items-center">
          <input
            id="discrepancy-tolerance"
            inputMode="decimal"
            value={tolerance}
            onChange={event => setTolerance(event.target.value)}
            className="w-36 border border-gray-300 rounded-lg p-2 text-sm"
            aria-describedby="discrepancy-tolerance-help"
          />
          <span id="discrepancy-tolerance-help" className="text-sm text-gray-600">{APP_CONFIG.currency}</span>
        </div>
        <button onClick={savePreferences} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          <Save size={16} /> {saving ? 'Saving…' : 'Save Preferences'}
        </button>
      </section>
    </div>
  );
}
