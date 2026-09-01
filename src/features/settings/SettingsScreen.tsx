import React, { useState } from 'react';
import { useToast } from '../../components/ui/Toast';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { User, Tags, Key, Download, Shield, LogOut, ChevronRight, Activity, Cpu } from 'lucide-react';
import { useAuth } from './../auth/AuthContext';
import { useAiKeys } from './ai/AiKeysContext';
import { RouteLoadingState } from '../../components/ui/LoadingState';
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
const AiKeysSettings = React.lazy(() => import('./ai/AiKeysSettings').then(module => ({ default: module.AiKeysSettings })));
const AiSimulator = React.lazy(() => import('./ai/AiSimulator').then(module => ({ default: module.AiSimulator })));
const ExtractionTest = React.lazy(() => import('./ai/ExtractionTest').then(module => ({ default: module.ExtractionTest })));
const CategoriesSettings = React.lazy(() => import('./CategoriesSettings').then(module => ({ default: module.CategoriesSettings })));
const DataExportSettings = React.lazy(() => import('./DataExportSettings').then(module => ({ default: module.DataExportSettings })));
const PrivacyScreen = React.lazy(() => import('./PrivacyScreen').then(module => ({ default: module.PrivacyScreen })));
const PreferencesScreen = React.lazy(() => import('./PreferencesScreen').then(module => ({ default: module.PreferencesScreen })));
const MerchantAliasesSettings = React.lazy(() => import('./MerchantAliasesSettings').then(module => ({ default: module.MerchantAliasesSettings })));
const SyncDiagnostic = React.lazy(() => import('./SyncDiagnostic').then(module => ({ default: module.SyncDiagnostic })));

function SettingsView({ children }: { children: React.ReactNode }) {
  return <React.Suspense fallback={<RouteLoadingState />}>{children}</React.Suspense>;
}

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
    return <SettingsView><div className="max-w-2xl mx-auto"><PreferencesScreen onBack={() => setActiveView('main')} /></div></SettingsView>;
  }

  if (activeView === 'ai-keys') {
    return (
      <SettingsView><div className="max-w-2xl mx-auto">
        <AiKeysSettings onBack={() => setActiveView('main')} />
      </div></SettingsView>
    );
  }

  if (activeView === 'categories') {
    return (
      <SettingsView><div className="max-w-2xl mx-auto">
        <CategoriesSettings onBack={() => setActiveView('main')} />
      </div></SettingsView>
    );
  }

  if (activeView === 'aliases') {
    return <SettingsView><div className="max-w-2xl mx-auto"><MerchantAliasesSettings onBack={() => setActiveView('main')} /></div></SettingsView>;
  }

  if (activeView === 'privacy') {
    return (
      <SettingsView><div className="max-w-2xl mx-auto space-y-6">
        <header className="pb-4 border-b border-gray-200 flex items-center gap-4">
          <button onClick={() => setActiveView('main')} aria-label="Back to settings" className="touch-target p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500">
             <ChevronRight className="rotate-180" size={20} />
          </button>
          <h2 className="text-xl font-bold text-gray-900">Privacy</h2>
        </header>
        <PrivacyScreen />
      </div></SettingsView>
    );
  }

  if (activeView === 'export') {
    return (
      <SettingsView><div className="max-w-2xl mx-auto">
        <DataExportSettings onBack={() => setActiveView('main')} />
      </div></SettingsView>
    );
  }

  if (developerMode && activeView === 'simulator') {
    return (
      <SettingsView><div className="max-w-2xl mx-auto space-y-6">
        <header className="pb-4 border-b border-gray-200 flex items-center gap-4">
          <button onClick={() => setActiveView('main')} aria-label="Back to settings" className="touch-target p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500">
             <ChevronRight className="rotate-180" size={20} />
          </button>
          <h2 className="text-xl font-bold text-gray-900">AI Simulator</h2>
        </header>
        <AiSimulator />
      </div></SettingsView>
    );
  }

  if (developerMode && activeView === 'extraction-test') {
    return (
      <SettingsView><div className="max-w-2xl mx-auto space-y-6">
        <header className="pb-4 border-b border-gray-200 flex items-center gap-4">
          <button onClick={() => setActiveView('main')} aria-label="Back to settings" className="touch-target p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500">
             <ChevronRight className="rotate-180" size={20} />
          </button>
          <h2 className="text-xl font-bold text-gray-900">Extraction Test</h2>
        </header>
        <ExtractionTest />
      </div></SettingsView>
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
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="page-header items-center">
        <h1 className="page-title">Settings</h1>
        <div className="flex items-center gap-3">
          {user?.photoURL ? (
            <img src={user.photoURL} alt="Profile" width={32} height={32} decoding="async" className="h-8 w-8 rounded-full border border-gray-200 md:hidden" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700 md:hidden">
              {user?.email?.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </header>

      <div className="space-y-8">
        {settingsSections.map((section) => (
          <div key={section.title}>
            <h2 className="section-label mb-3 px-2">
              {section.title}
            </h2>
            <div className="app-card overflow-hidden">
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

      {developerMode && <SettingsView><SyncDiagnostic /></SettingsView>}

      <div className="pt-4 space-y-4">
        <div className="app-card space-y-4 p-5 sm:p-6">
          <h3 className="font-bold text-gray-900">Device Security & Cache</h3>
          <p className="text-sm text-gray-500">
            By default, KharchaLens stores data only in temporary memory. If this is your personal, trusted device, you can enable persistent offline cache. Changing this setting requires the app to reinitialize Firestore, so it takes effect only after a reload.
          </p>
          <label className="relative flex min-h-12 cursor-pointer items-center justify-between gap-4 rounded-xl border border-gray-200 p-3 hover:bg-gray-50">
            <span className="text-sm font-medium text-gray-900 select-none">This is a trusted device</span>
            <input 
              type="checkbox" 
              className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
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
            <span aria-hidden="true" className="relative h-6 w-11 shrink-0 rounded-full bg-gray-300 transition-colors after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-blue-600 peer-checked:after:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-blue-600 peer-disabled:opacity-50" />
          </label>
          <label className="relative flex min-h-14 cursor-pointer items-start justify-between gap-4 rounded-xl border border-gray-200 p-3 hover:bg-gray-50">
            <span className="text-sm text-gray-700">
              <span className="block font-medium text-gray-900">Clear offline data when signing out</span>
              Recommended for shared devices. This is off by default and clears Firestore cache and the local key vault only after a successful sign-out.
            </span>
            <input
              type="checkbox"
              className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              checked={clearOfflineDataOnSignOut}
              disabled={isCacheActionPending}
              onChange={(event) => setClearOnSignOut(event.target.checked)}
            />
            <span aria-hidden="true" className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-gray-300 transition-colors after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-blue-600 peer-checked:after:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-blue-600 peer-disabled:opacity-50" />
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
          className="btn-outline w-full"
        >
          <Cpu size={18} />
          Clear this device's offline data
        </button>


        <button 
          onClick={() => void signOut()}
          className="btn-outline w-full border-red-200 text-red-700 hover:bg-red-50"
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
