import React, { useState } from 'react';
import { useToast } from '../../components/ui/Toast';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { User, Tags, Key, Download, Shield, Info, LogOut, ChevronRight, Activity, Cpu } from 'lucide-react';
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

export function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { clearLocalVault } = useAiKeys();
  const { showToast } = useToast();
  const [isTrustedDevice, setIsTrustedDevice] = useState<boolean>(() => {
    return localStorage.getItem('kharchalens_trusted_device') === 'true';
  });
  const [confirmAction, setConfirmAction] = useState<{ message: string, action: () => void } | null>(null);
  const [activeView, setActiveView] = useState<'main' | 'preferences' | 'ai-keys' | 'simulator' | 'extraction-test' | 'categories' | 'aliases' | 'export' | 'privacy'>('main');

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
          <button onClick={() => setActiveView('main')} className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500">
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

  if (activeView === 'simulator') {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="pb-4 border-b border-gray-200 flex items-center gap-4">
          <button onClick={() => setActiveView('main')} className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500">
             <ChevronRight className="rotate-180" size={20} />
          </button>
          <h2 className="text-xl font-bold text-gray-900">AI Simulator</h2>
        </header>
        <AiSimulator />
      </div>
    );
  }

  if (activeView === 'extraction-test') {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="pb-4 border-b border-gray-200 flex items-center gap-4">
          <button onClick={() => setActiveView('main')} className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500">
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
        ...(import.meta.env.DEV ? [
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
        { id: 'about', label: 'About KharchaLens', icon: Info, value: 'v1.0.0-dev' },
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
                        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors text-left"
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

      <SyncDiagnostic />

      <div className="pt-4 space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
          <h3 className="font-bold text-gray-900">Device Security & Cache</h3>
          <p className="text-sm text-gray-500">
            By default, KharchaLens stores data only in temporary memory. If this is your personal, trusted device, you can enable persistent offline cache. This allows the app to load instantly and work offline.
          </p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input 
              type="checkbox" 
              className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
              checked={isTrustedDevice}
              onChange={(e) => {
                const checked = e.target.checked;
                setIsTrustedDevice(checked);
                if (checked) {
                  localStorage.setItem('kharchalens_trusted_device', 'true');
                  showToast("This device is now marked as trusted.", "success");
                } else {
                  localStorage.removeItem('kharchalens_trusted_device');
                  showToast("Trusted device mode disabled.", "info");
                }
              }}
            />
            <span className="text-sm font-medium text-gray-900 select-none">This is a trusted device</span>
          </label>
        </div>
      </div>


      <div className="pt-4 pb-8 space-y-4">
        
        <button 
          onClick={() => {
    setConfirmAction({
      message: "This clears locally cached receipt data and all Gemini-key vault records on this device. Pending writes may be lost. It will NOT delete cloud data. Proceed?",
      action: async () => {
        
              try {
                await clearLocalVault();
                const { db } = await import('../../services/firebase/config');
                const { clearIndexedDbPersistence, terminate } = await import('firebase/firestore');
                
                await terminate(db);
                await clearIndexedDbPersistence(db);
                
                // Remove obsolete localStorage vault remnants from earlier builds too.
                localStorage.removeItem('kharchalens_vault_salt');
                localStorage.removeItem('kharchalens_vault_iv');
                localStorage.removeItem('kharchalens_vault_data');
                
                
                showToast("Offline data cleared. The app will now reload.", "success");
                window.location.reload();
              } catch {
                showToast('Could not clear offline data. Please try again.', 'error');
              }
            
      }
    });
  }}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-white border border-gray-300 text-gray-700 rounded-xl shadow-sm font-medium hover:bg-gray-50 transition-colors"
        >
          <Cpu size={18} />
          Clear this device's offline data
        </button>


        <button 
          onClick={() => signOut()}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-white border border-red-200 text-red-600 rounded-xl shadow-sm font-medium hover:bg-red-50 transition-colors"
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </div>

      <ConfirmDialog
        isOpen={confirmAction !== null}
        title="Confirmation"
        message={confirmAction?.message || ''}
        isDestructive={true}
        confirmText="Proceed"
        onConfirm={() => {
          if (confirmAction) {
            confirmAction.action();
            setConfirmAction(null);
          }
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
