import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { AiKeySlot, StoredKeyRecord } from '../../../domain/aiTypes';
import { AiVault } from '../../../services/ai/vault';
import { CryptoUtils } from '../../../services/ai/crypto';
import { KeyRotationManager } from '../../../services/ai/KeyRotationManager';
import { AiRequestExecutor } from '../../../services/ai/AiRequestExecutor';
import { useAuth } from '../../auth/AuthContext';

interface AiKeysContextType {
  slots: AiKeySlot[];
  vaultState: 'unconfigured' | 'locked' | 'unlocked';
  setInitialPassphrase: (passphrase: string) => void;
  unlockVault: (passphrase?: string) => Promise<boolean>;
  lockVault: () => void;
  setKey: (slotId: number, rawKey: string, label: string, isSessionOnly: boolean) => Promise<void>;
  removeKey: (slotId: number) => Promise<void>;
  toggleKey: (slotId: number, isEnabled: boolean) => Promise<void>;
  executor: AiRequestExecutor | null;
  getDecryptedKey: (index: number) => Promise<string | null>;
  rotationManager: KeyRotationManager | null;
  // For Simulator
  activeKeyIndex: number | null;
}

const AiKeysContext = createContext<AiKeysContextType | undefined>(undefined);

export function AiKeysProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [slots, setSlots] = useState<AiKeySlot[]>([]);
  const [vaultState, setVaultState] = useState<'unconfigured' | 'locked' | 'unlocked'>('unlocked');
  const [activeKeyIndex, setActiveKeyIndex] = useState<number | null>(null);

  const vaultRef = useRef<AiVault | null>(null);
  const rotationManagerRef = useRef<KeyRotationManager>(new KeyRotationManager());
  const executorRef = useRef<AiRequestExecutor>(new AiRequestExecutor(rotationManagerRef.current));
  
  // In-memory key store
  const memoryKeysRef = useRef<Record<number, string>>({});

  // Initialize and load keys directly
  useEffect(() => {
    if (user) {
      vaultRef.current = new AiVault(user.uid);
      loadStoredKeys();
    } else {
      vaultRef.current = null;
      setSlots([]);
      memoryKeysRef.current = {};
      setVaultState('unconfigured');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Keep rotation manager in sync with state
  useEffect(() => {
    rotationManagerRef.current.updateSlots(slots);
    rotationManagerRef.current.setOnSlotsChanged((newSlots) => {
      setSlots(newSlots);
    });
  }, [slots]);

  const loadStoredKeys = async () => {
    if (!vaultRef.current) return;
    try {
      const stored = await vaultRef.current.getKeys();
      const loadedSlots: AiKeySlot[] = [];
      const loadedMemory: Record<number, string> = {};

      for (const record of stored) {
        if (record.key) {
          loadedMemory[record.slotId] = record.key;
        }
        loadedSlots.push({
          slotId: record.slotId,
          label: record.label,
          maskedKey: record.maskedKey || (record.key ? CryptoUtils.maskKey(record.key) : '••••••••'),
          isEnabled: record.isEnabled ?? true,
          isSessionOnly: false,
          status: 'untested',
        });
      }

      memoryKeysRef.current = loadedMemory;
      setSlots(loadedSlots);
      setVaultState('unlocked');
    } catch (e) {
      console.error('Failed to load stored keys', e);
      setVaultState('unlocked');
    }
  };

  const lockVault = () => {
    // Kept for backward compatibility if invoked
  };

  const unlockVault = async (_passphrase?: string): Promise<boolean> => {
    await loadStoredKeys();
    setVaultState('unlocked');
    return true;
  };

  const setInitialPassphrase = (_passphrase: string) => {
    setVaultState('unlocked');
  };

  const setKey = async (slotId: number, rawKey: string, label: string, isSessionOnly: boolean) => {
    const existing = slots.find(s => s.slotId === slotId);
    if (existing && !existing.isSessionOnly && isSessionOnly && vaultRef.current) {
      await vaultRef.current.removeKey(slotId);
    }

    memoryKeysRef.current[slotId] = rawKey;
    const maskedKey = CryptoUtils.maskKey(rawKey);

    if (!isSessionOnly && vaultRef.current) {
      const record: StoredKeyRecord = {
        slotId,
        label,
        maskedKey,
        key: rawKey,
        isEnabled: true,
      };
      await vaultRef.current.saveKey(record);
    }

    setVaultState('unlocked');

    setSlots(prev => {
      const existingSlot = prev.find(s => s.slotId === slotId);
      if (existingSlot) {
        return prev.map(s => s.slotId === slotId ? {
          ...s, label, maskedKey, isSessionOnly, isEnabled: true, status: 'untested' as const
        } : s);
      }
      return [...prev, {
        slotId, label, maskedKey, isEnabled: true, isSessionOnly, status: 'untested' as const
      }].sort((a, b) => a.slotId - b.slotId);
    });
  };

  const removeKey = async (slotId: number) => {
    delete memoryKeysRef.current[slotId];
    if (vaultRef.current) {
      await vaultRef.current.removeKey(slotId);
    }
    setSlots(prev => prev.filter(s => s.slotId !== slotId));
  };

  const toggleKey = async (slotId: number, isEnabled: boolean) => {
    if (vaultRef.current && !slots.find(s => s.slotId === slotId)?.isSessionOnly) {
      const stored = await vaultRef.current.getKeys();
      const record = stored.find(s => s.slotId === slotId);
      if (record) {
        record.isEnabled = isEnabled;
        await vaultRef.current.saveKey(record);
      }
    }
    setSlots(prev => prev.map(s => s.slotId === slotId ? { ...s, isEnabled } : s));
  };

  const getDecryptedKey = async (index: number): Promise<string | null> => {
    const slot = slots[index];
    if (!slot) return null;
    setActiveKeyIndex(index);
    // Fake small delay to show UI active state
    await new Promise(r => setTimeout(r, 100));
    return memoryKeysRef.current[slot.slotId] || null;
  };

  return (
    <AiKeysContext.Provider value={{
      slots,
      vaultState,
      setInitialPassphrase,
      unlockVault,
      lockVault,
      setKey,
      removeKey,
      toggleKey,
      executor: executorRef.current,
      getDecryptedKey,
      rotationManager: rotationManagerRef.current,
      activeKeyIndex
    }}>
      {children}
    </AiKeysContext.Provider>
  );
}

export function useAiKeys() {
  const ctx = useContext(AiKeysContext);
  if (!ctx) throw new Error('useAiKeys must be used within AiKeysProvider');
  return ctx;
}
