import React, { useState } from 'react';
import { useToast } from '../../components/ui/Toast';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { User, Tags, Key, Download, Shield, LogOut, ChevronRight, Activity, Cpu } from 'lucide-react';
import { useAuth } from './../auth/AuthContext';
import { AiKeysSettings } from './ai/AiKeysSettings';
import { AiSimulator } from './ai/AiSimulator';
import { ExtractionTest } from './ai/ExtractionTest';
import { CategoriesSettings } from './CategoriesSettings';
import { DataExportSettings } from './DataExportSettings';
import { PrivacyScreen } from './PrivacyScreen';
import { SyncDiagnostic } from './SyncDiagnostic';
import { useAiKeys } from './ai/AiKeysContext';
import { PreferencesScreen } from './PreferencesScreen';
import { MerchantAliasesSettings } from './MerchantAliasesSettings';
import { db } from '../../services/firebase/config';
import {
  clearLegacyVaultRemnants,
  clearOfflineDeviceData,
  getClearOfflineDataOnSignOutPreference,
  getTrustedDevicePreference,
  setClearOfflineDataOnSignOutPreference,
  setTrustedDevicePreference,
} from '../../services/firebase/offlineStorage';

type ConfirmAction = {
  title: string;
  message: string;
  confirmText: string;
  isDestructive?: boolean;
  action: () => Promise<void>;
};

const developerMode = import.meta.env.VITE_DEVELOPER_MODE === 'true';

export function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { clearLocalVault } = useAiKeys();
  const { showToast } = useToast();
  const [isTrustedDevice, setIsTrustedDevice] = useState<boolean>(() => getTrustedDevicePreference());
  const [clearOfflineDataOnSignOut, setClearOfflineDataOnSignOut] = useState<boolean>(() => getClearOfflineDataOnSignOutPreference());
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [isCacheActionPending, setIsCacheActionPending] = useState(false);
  const [activeView, setActiveView] = useState<'main' | 'preferences' | 'ai-keys' | 'simulator' | 'extraction-test' | 'categories' | 'aliases' | 'export' | 'privacy'>('main');

  const clearCurrentDeviceData = async (disableTrustedDevice: boolean) => {
    if (isCacheActionPending) return;
    setIsCacheActionPending(true);
    try {
      const { clearIndexedDbPersistence, terminate } = await import('firebase/firestore');
      await clearOfflineDeviceData({
        terminateFirestore: () => terminate(db),
        clearFirestorePersistence: () => clearIndexedDbPersistence(db),
        clearLocalVault,
        clearLegacyVaultRemnants,
      });
      if (disableTrustedDevice && !setTrustedDevicePreference(false)) {
        throw new Error('Could not save the updated device preference.');
      }
      if (disableTrustedDevice) setIsTrustedDevice(false);
      showToast('Offline cache and local key-vault data were cleared. Reloading…', 'success');
      window.location.reload();
    } catch {
      // A failed clear means we must not imply that a shared device is clean.
      showToast('Could not confirm that local offline data was cleared. Reload and try again before sharing this device.', 'error');
    } finally {
      setIsCacheActionPending(false);
    }
  };

  const enableTrustedDevice = async () => {
    if (isCacheActionPending) return;
    setIsCacheActionPending(true);
    try {
      if (!setTrustedDevicePreference(true)) {
        throw new Error('Could not save the device preference.');
      }
      setIsTrustedDevice(true);
      showToast('Trusted-device cache will be enabled after this reload.', 'success');
      window.location.reload();
    } catch {
      showToast('Could not enable trusted-device mode in this browser.', 'error');
    } finally {
      setIsCacheActionPending(false);
    }
  };

  const setClearOnSignOut = (enabled: boolean) => {
    if (!setClearOfflineDataOnSignOutPreference(enabled)) {
      showToast('Could not save this shared-device preference in this browser.', 'error');
      return;
    }
    setClearOfflineDataOnSignOut(enabled);
  };

  if (activeView === 'preferences') {
    return <div className="max-w-2xl mx-auto"><PreferencesScreen onBack={() => setActiveView('main')} /></div>;
  }

  if (activeView === 'ai-keys') {
    return (
      <div className="max-w-2xl mx-auto">
        <AiKeysSettings onBack={() => setActiveView('main')} />
      </div>
    );
  }

  if (activeView === 'categories') {
    return (
      <div className="max-w-2xl mx-auto">
        <CategoriesSettings onBack={() => setActiveView('main')} />
      </div>
    );
  }

  if (activeView === 'aliases') {
    return <div className="max-w-2xl mx-auto"><MerchantAliasesSettings onBack={() => setActiveView('main')} /></div>;
  }

  if (activeView === 'privacy') {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="pb-4 border-b border-gray-200 flex items-center gap-4">
          <button onClick={() => setActiveView('main')} aria-label="Back to settings" className="touch-target p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500">
             <ChevronRight className="rotate-180" size={20} />
          </button>
          <h2 className="text-xl font-bold text-gray-900">Privacy</h2>
        </header>
        <PrivacyScreen />
      </div>
    );
  }

  if (activeView === 'export') {
    return (
      <div className="max-w-2xl mx-auto">
        <DataExportSettings onBack={() => setActiveView('main')} />
      </div>
    );
  }

  if (developerMode && activeView === 'simulator') {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="pb-4 border-b border-gray-200 flex items-center gap-4">
          <button onClick={() => setActiveView('main')} aria-label="Back to settings" className="touch-target p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500">
             <ChevronRight className="rotate-180" size={20} />
          </button>
          <h2 className="text-xl font-bold text-gray-900">AI Simulator</h2>
        </header>
        <AiSimulator />
      </div>
    );
  }

  if (developerMode && activeView === 'extraction-test') {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="pb-4 border-b border-gray-200 flex items-center gap-4">
          <button onClick={() => setActiveView('main')} aria-label="Back to settings" className="touch-target p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500">
             <ChevronRight className="rotate-180" size={20} />
          </button>
          <h2 className="text-xl font-bold text-gray-900">Extraction Test</h2>
        </header>
        <ExtractionTest />
      </div>
    );
  }

  const settingsSections = [
    {
      title: 'Account',
      items: [
        { 
          id: 'profile', 
          label: 'Profile & Preferences', 
          icon: User, 
          value: user?.displayName || user?.email || 'Unknown User',
          onClick: () => setActiveView('preferences'),
        },
        { id: 'categories', label: 'Custom Categories', icon: Tags, onClick: () => setActiveView('categories') },
        { id: 'aliases', label: 'Merchant Aliases', icon: Tags, onClick: () => setActiveView('aliases') },
      ]
    },
    {
      title: 'Advanced',
      items: [
        { id: 'ai-keys', label: 'AI Configuration', icon: Key, onClick: () => setActiveView('ai-keys') },
        ...(developerMode ? [
          { id: 'simulator', label: 'AI Rotation Simulator', icon: Activity, onClick: () => setActiveView('simulator') },
          { id: 'extraction-test', label: 'Test Gemini Extraction', icon: Activity, onClick: () => setActiveView('extraction-test') },
        ] : []),
        { id: 'export', label: 'Data & Exports', icon: Download, onClick: () => setActiveView('export') },
      ]
    },
    {
      title: 'About',
      items: [
        { id: 'privacy', label: 'Privacy Policy', icon: Shield, onClick: () => setActiveView('privacy') },
      ]
    }
  ];

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <header className="pb-4 border-b border-gray-200 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <div className="flex items-center gap-3">
          {user?.photoURL ? (
            <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-gray-200" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm">
              {user?.email?.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </header>

      <div className="space-y-8">
        {settingsSections.map((section) => (
          <div key={section.title}>
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 px-2">
              {section.title}
            </h2>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <ul className="divide-y divide-gray-200">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.id}>
                      <button 
                        onClick={item.onClick}
                        className="touch-target w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className="bg-gray-100 p-2 rounded-lg">
                            <Icon size={20} className="text-gray-600" />
                          </div>
                          <span className="font-medium text-gray-900">{item.label}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {item.value && (
                            <span className="text-sm text-gray-500 truncate max-w-[150px] sm:max-w-xs">{item.value}</span>
                          )}
                          <ChevronRight size={18} className="text-gray-400" />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ))}
      </div>

      {developerMode && <SyncDiagnostic />}

      <div className="pt-4 space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
          <h3 className="font-bold text-gray-900">Device Security & Cache</h3>
          <p className="text-sm text-gray-500">
            By default, KharchaLens stores data only in temporary memory. If this is your personal, trusted device, you can enable persistent offline cache. Changing this setting requires the app to reinitialize Firestore, so it takes effect only after a reload.
          </p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input 
              type="checkbox" 
              className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
              checked={isTrustedDevice}
              disabled={isCacheActionPending}
              onChange={(event) => {
                if (event.target.checked) {
                  setConfirmAction({
                    title: 'Enable trusted-device cache?',
                    message: 'Persistent Firestore cache can retain receipt text on this device. The app will reload to initialize Firestore with this setting.',
                    confirmText: 'Enable and reload',
                    action: enableTrustedDevice,
                  });
                  return;
                }
                setConfirmAction({
                  title: 'Disable trusted-device cache?',
                  message: 'This immediately terminates Firestore, clears its IndexedDB cache and local Gemini vault data, then reloads. Pending local writes may be lost.',
                  confirmText: 'Clear cache and reload',
                  isDestructive: true,
                  action: () => clearCurrentDeviceData(true),
                });
              }}
            />
            <span className="text-sm font-medium text-gray-900 select-none">This is a trusted device</span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
              checked={clearOfflineDataOnSignOut}
              disabled={isCacheActionPending}
              onChange={(event) => setClearOnSignOut(event.target.checked)}
            />
            <span className="text-sm text-gray-700">
              <span className="block font-medium text-gray-900">Clear offline data when signing out</span>
              Recommended for shared devices. This is off by default and clears Firestore cache and the local key vault only after a successful sign-out.
            </span>
          </label>
        </div>
      </div>


      <div className="pt-4 pb-8 space-y-4">
        
        <button
          onClick={() => setConfirmAction({
            title: 'Clear this device’s offline data?',
            message: 'This terminates Firestore, clears its IndexedDB cache and all local Gemini-key vault records. Pending local writes may be lost. Cloud data is not deleted.',
            confirmText: 'Clear and reload',
            isDestructive: true,
            action: () => clearCurrentDeviceData(false),
          })}
          disabled={isCacheActionPending}
          className="touch-target w-full flex items-center justify-center gap-2 py-3 px-4 bg-white border border-gray-300 text-gray-700 rounded-xl shadow-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <Cpu size={18} />
          Clear this device's offline data
        </button>


        <button 
          onClick={() => void signOut()}
          className="touch-target w-full flex items-center justify-center gap-2 py-3 px-4 bg-white border border-red-200 text-red-700 rounded-xl shadow-sm font-medium hover:bg-red-50 transition-colors"
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </div>

      <ConfirmDialog
        isOpen={confirmAction !== null}
        title={confirmAction?.title || 'Confirmation'}
        message={confirmAction?.message || ''}
        isDestructive={confirmAction?.isDestructive ?? false}
        confirmText={isCacheActionPending ? 'Working…' : (confirmAction?.confirmText || 'Proceed')}
        onConfirm={() => {
          if (confirmAction && !isCacheActionPending) {
            void confirmAction.action();
            setConfirmAction(null);
          }
        }}
        onCancel={() => !isCacheActionPending && setConfirmAction(null)}
      />
    </div>
  );
}
