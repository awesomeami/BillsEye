import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AiKeySlot, LocalKeyRecord, VaultState } from '../../../domain/aiTypes';
import { AiVault, getVaultStartupState } from '../../../services/ai/vault';
import { CryptoUtils } from '../../../services/ai/crypto';
import { KeyRotationManager } from '../../../services/ai/KeyRotationManager';
import { AiRequestExecutor } from '../../../services/ai/AiRequestExecutor';
import { useAuth } from '../../auth/AuthContext';
import { isE2eMockMode } from '../../../config/e2eMocks';

interface AiKeysContextType {
  slots: AiKeySlot[];
  vaultState: VaultState;
  legacySlotIds: number[];
  clearLegacyKeys: () => Promise<void>;
  clearLocalVault: () => Promise<void>;
  setKey: (slotId: number, rawKey: string, label: string) => Promise<void>;
  removeKey: (slotId: number) => Promise<void>;
  toggleKey: (slotId: number, isEnabled: boolean) => Promise<void>;
  executor: AiRequestExecutor | null;
  getDecryptedKey: (index: number) => Promise<string | null>;
  rotationManager: KeyRotationManager | null;
  activeKeyIndex: number | null;
}

const AiKeysContext = createContext<AiKeysContextType | undefined>(undefined);
const useE2eMocks = isE2eMockMode;
const e2eKeySlot: AiKeySlot = {
  slotId: 0,
  label: 'Browser-test key',
  maskedKey: '••••test',
  isEnabled: true,
  isSessionOnly: false,
  status: 'healthy',
};

export function AiKeysProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [slots, setSlots] = useState<AiKeySlot[]>([]);
  const [vaultState, setVaultState] = useState<VaultState>('unconfigured');
  const [legacySlotIds, setLegacySlotIds] = useState<number[]>([]);
  const [activeKeyIndex, setActiveKeyIndex] = useState<number | null>(null);

  const vaultRef = useRef<AiVault | null>(null);
  const rotationManagerRef = useRef<KeyRotationManager>(new KeyRotationManager());
  const executorRef = useRef<AiRequestExecutor>(new AiRequestExecutor(rotationManagerRef.current));
  const memoryKeysRef = useRef<Record<number, string>>({});
  const localSlotIdsRef = useRef<Set<number>>(new Set());
  const legacySlotIdsRef = useRef<Set<number>>(new Set());
  const authGenerationRef = useRef(0);

  const clearKeyMaterialRefs = () => {
    memoryKeysRef.current = {};
    localSlotIdsRef.current = new Set();
    legacySlotIdsRef.current = new Set();
  };

  const clearKeyMaterial = () => {
    clearKeyMaterialRefs();
    setSlots([]);
    setLegacySlotIds([]);
    setActiveKeyIndex(null);
  };

  const loadVault = async (vault: AiVault, generation: number) => {
    try {
      const inspection = await vault.getInspection();
      if (generation !== authGenerationRef.current || vault !== vaultRef.current) return;

      localSlotIdsRef.current = new Set(inspection.localKeys.map(record => record.slotId));
      legacySlotIdsRef.current = new Set(inspection.legacyKeys.map(record => record.slotId));
      memoryKeysRef.current = Object.fromEntries(inspection.localKeys.map(record => [record.slotId, record.key]));
      setLegacySlotIds([...legacySlotIdsRef.current].sort((left, right) => left - right));

      const localSlots = inspection.localKeys.map(record => ({
        slotId: record.slotId,
        label: record.label,
        maskedKey: CryptoUtils.redactString(record.maskedKey || '••••••••'),
        isEnabled: record.isEnabled,
        isSessionOnly: false,
        status: 'untested' as const,
      }));
      const legacySlots = inspection.legacyKeys
        .filter(record => !localSlotIdsRef.current.has(record.slotId))
        .map(record => ({
          slotId: record.slotId,
          label: `Key slot ${record.slotId}`,
          maskedKey: '••••••••',
          isEnabled: false,
          isSessionOnly: false,
          status: 'untested' as const,
          requiresMigration: true,
        }));
      setSlots([...localSlots, ...legacySlots].sort((left, right) => left.slotId - right.slotId));
      setVaultState(getVaultStartupState(inspection));
    } catch {
      if (generation === authGenerationRef.current) setVaultState('unconfigured');
    }
  };

  useEffect(() => {
    const generation = ++authGenerationRef.current;
    const disposeSession = () => {
      authGenerationRef.current += 1;
      vaultRef.current = null;
      clearKeyMaterialRefs();
      rotationManagerRef.current.updateSlots([]);
      rotationManagerRef.current.setOnSlotsChanged(() => undefined);
    };
    clearKeyMaterial();
    if (useE2eMocks && user) {
      rotationManagerRef.current.updateSlots([e2eKeySlot]);
      setSlots([e2eKeySlot]);
      setVaultState('unlocked');
      return disposeSession;
    }
    if (!user) {
      vaultRef.current = null;
      setVaultState('unconfigured');
      return disposeSession;
    }
    const vault = new AiVault(user.uid);
    vaultRef.current = vault;
    void loadVault(vault, generation);
    return disposeSession;
    // The generation check in loadVault prevents an old user's async read from winning a later auth transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  useEffect(() => {
    rotationManagerRef.current.updateSlots(slots);
    rotationManagerRef.current.setOnSlotsChanged(setSlots);
  }, [slots]);

  const setKey = async (slotId: number, rawKey: string, label: string) => {
    const key = rawKey.trim();
    if (!key) throw new Error('Enter a Gemini API key.');
    const vault = vaultRef.current;
    if (!vault) throw new Error('Sign in before managing API keys.');

    const record: LocalKeyRecord = {
      slotId,
      label,
      maskedKey: CryptoUtils.maskKey(key),
      isEnabled: true,
      recordVersion: 3,
      key,
    };
    await vault.saveLocalKey(record);
    if (vault !== vaultRef.current) return;

    localSlotIdsRef.current.add(slotId);
    legacySlotIdsRef.current.delete(slotId);
    memoryKeysRef.current[slotId] = key;
    setLegacySlotIds([...legacySlotIdsRef.current].sort((left, right) => left - right));
    setSlots(previous => {
      const nextSlot: AiKeySlot = {
        slotId,
        label,
        maskedKey: record.maskedKey,
        isEnabled: true,
        isSessionOnly: false,
        status: 'untested',
      };
      return [...previous.filter(slot => slot.slotId !== slotId), nextSlot]
        .sort((left, right) => left.slotId - right.slotId);
    });
    setVaultState('unlocked');
  };

  const removeKey = async (slotId: number) => {
    const vault = vaultRef.current;
    if (vault) await vault.removeKey(slotId);
    if (vault !== vaultRef.current) return;

    delete memoryKeysRef.current[slotId];
    localSlotIdsRef.current.delete(slotId);
    legacySlotIdsRef.current.delete(slotId);
    setLegacySlotIds([...legacySlotIdsRef.current].sort((left, right) => left - right));
    setSlots(previous => previous.filter(slot => slot.slotId !== slotId));
    setVaultState(localSlotIdsRef.current.size > 0
      ? 'unlocked'
      : legacySlotIdsRef.current.size > 0 ? 'migration-required' : 'unconfigured');
  };

  const clearLegacyKeys = async () => {
    const vault = vaultRef.current;
    if (!vault) return;
    await vault.clearLegacyForUser();
    if (vault !== vaultRef.current) return;

    legacySlotIdsRef.current.forEach(slotId => delete memoryKeysRef.current[slotId]);
    legacySlotIdsRef.current = new Set();
    setLegacySlotIds([]);
    setSlots(previous => previous.filter(slot => !slot.requiresMigration));
    setVaultState(localSlotIdsRef.current.size > 0 ? 'unlocked' : 'unconfigured');
  };

  const clearLocalVault = async () => {
    const vault = vaultRef.current;
    if (vault) await vault.clearAllForUser();
    if (vault !== vaultRef.current) return;
    clearKeyMaterial();
    setVaultState('unconfigured');
  };

  const toggleKey = async (slotId: number, isEnabled: boolean) => {
    const vault = vaultRef.current;
    const slot = slots.find(candidate => candidate.slotId === slotId);
    if (slot?.requiresMigration) return;
    if (vault) await vault.updateKeyEnabled(slotId, isEnabled);
    if (vault !== vaultRef.current) return;
    setSlots(previous => previous.map(candidate => candidate.slotId === slotId ? { ...candidate, isEnabled } : candidate));
  };

  const getDecryptedKey = async (index: number): Promise<string | null> => {
    if (useE2eMocks) return index === 0 ? 'e2e-gemini-key' : null;
    const slot = slots[index];
    if (!slot) return null;
    setActiveKeyIndex(index);
    return memoryKeysRef.current[slot.slotId] || null;
  };

  return (
    <AiKeysContext.Provider value={{
      slots,
      vaultState,
      legacySlotIds,
      clearLegacyKeys,
      clearLocalVault,
      setKey,
      removeKey,
      toggleKey,
      executor: executorRef.current,
      getDecryptedKey,
      rotationManager: rotationManagerRef.current,
      activeKeyIndex,
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
