import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { AiKeySlot, EncryptedKeyRecord, VaultState } from '../../../domain/aiTypes';
import { AiVault, getVaultStartupState, shouldPersistKey } from '../../../services/ai/vault';
import { CryptoUtils } from '../../../services/ai/crypto';
import { KeyRotationManager } from '../../../services/ai/KeyRotationManager';
import { AiRequestExecutor } from '../../../services/ai/AiRequestExecutor';
import { useAuth } from '../../auth/AuthContext';
import { isE2eMockMode } from '../../../config/e2eMocks';

interface AiKeysContextType {
  slots: AiKeySlot[];
  vaultState: VaultState;
  legacySlotIds: number[];
  setInitialPassphrase: (passphrase: string) => Promise<void>;
  unlockVault: (passphrase: string) => Promise<boolean>;
  lockVault: () => void;
  clearLegacyKeys: () => Promise<void>;
  clearLocalVault: () => Promise<void>;
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
const useE2eMocks = isE2eMockMode;
const e2eKeySlot: AiKeySlot = {
  slotId: 0,
  label: 'Browser-test key',
  maskedKey: '••••test',
  isEnabled: true,
  isSessionOnly: true,
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
  const cryptoKeyRef = useRef<CryptoKey | null>(null);
  const encryptedSlotIdsRef = useRef<Set<number>>(new Set());
  const legacySlotIdsRef = useRef<Set<number>>(new Set());
  const authGenerationRef = useRef(0);

  const clearKeyMaterialRefs = () => {
    memoryKeysRef.current = {};
    cryptoKeyRef.current = null;
    encryptedSlotIdsRef.current = new Set();
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

      encryptedSlotIdsRef.current = new Set(inspection.encryptedKeys.map(record => record.slotId));
      legacySlotIdsRef.current = new Set(inspection.legacyKeys.map(record => record.slotId));
      setLegacySlotIds([...legacySlotIdsRef.current].sort((a, b) => a - b));
      const encryptedSlots = inspection.encryptedKeys.map(record => ({
        slotId: record.slotId,
        label: record.label,
        maskedKey: CryptoUtils.redactString(record.maskedKey || '••••••••'),
        isEnabled: record.isEnabled,
        isSessionOnly: false,
        status: 'untested' as const
      }));
      const legacySlots = inspection.legacyKeys
        .filter(record => !encryptedSlotIdsRef.current.has(record.slotId))
        .map(record => ({
          slotId: record.slotId,
          label: `Key slot ${record.slotId}`,
          maskedKey: '••••••••',
          isEnabled: false,
          isSessionOnly: false,
          status: 'untested' as const,
          requiresMigration: true
        }));
      setSlots([...encryptedSlots, ...legacySlots].sort((a, b) => a.slotId - b.slotId));
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

  const setInitialPassphrase = async (passphrase: string) => {
    if (passphrase.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
    const vault = vaultRef.current;
    if (!vault) throw new Error('Sign in before configuring persistent keys.');
    const inspection = await vault.getInspection();
    if (vault !== vaultRef.current) return;
    if (inspection.metadata || inspection.encryptedKeys.length > 0) {
      // During a legacy migration the passphrase-derived key is already in memory.
      if (cryptoKeyRef.current) return;
      throw new Error('This device vault already has a passphrase. Unlock it instead.');
    }
    const salt = CryptoUtils.generateSalt();
    const cryptoKey = await CryptoUtils.deriveKey(passphrase, salt);
    if (vault !== vaultRef.current) return;
    await vault.saveMetadata({ metadataVersion: 2, saltBase64: CryptoUtils.arrayBufferToBase64(salt) });
    if (vault !== vaultRef.current) return;
    cryptoKeyRef.current = cryptoKey;
    setVaultState(legacySlotIdsRef.current.size > 0 ? 'migration-required' : 'unlocked');
  };

  const lockVault = () => {
    for (const slotId of encryptedSlotIdsRef.current) delete memoryKeysRef.current[slotId];
    cryptoKeyRef.current = null;
    setActiveKeyIndex(null);
    if (encryptedSlotIdsRef.current.size > 0) setVaultState('locked');
  };

  const unlockVault = async (passphrase: string): Promise<boolean> => {
    const vault = vaultRef.current;
    if (!vault || !passphrase) return false;
    try {
      const inspection = await vault.getInspection();
      if (!inspection.metadata || inspection.encryptedKeys.length === 0) return false;
      const cryptoKey = await CryptoUtils.deriveKey(
        passphrase,
        CryptoUtils.base64ToArrayBuffer(inspection.metadata.saltBase64)
      );
      const decryptedEntries = await Promise.all(inspection.encryptedKeys.map(async record => ({
        slotId: record.slotId,
        key: await CryptoUtils.decryptWithKey(
          CryptoUtils.base64ToArrayBuffer(record.ciphertextBase64),
          cryptoKey,
          CryptoUtils.base64ToArrayBuffer(record.ivBase64)
        )
      })));
      if (vault !== vaultRef.current) return false;
      cryptoKeyRef.current = cryptoKey;
      decryptedEntries.forEach(entry => { memoryKeysRef.current[entry.slotId] = entry.key; });
      encryptedSlotIdsRef.current = new Set(inspection.encryptedKeys.map(record => record.slotId));
      legacySlotIdsRef.current = new Set(inspection.legacyKeys.map(record => record.slotId));
      setLegacySlotIds([...legacySlotIdsRef.current].sort((a, b) => a - b));
      setVaultState(legacySlotIdsRef.current.size > 0 ? 'migration-required' : 'unlocked');
      return true;
    } catch {
      // Wrong passphrases and malformed ciphertext are intentionally indistinguishable.
      return false;
    }
  };

  const setKey = async (slotId: number, rawKey: string, label: string, isSessionOnly: boolean) => {
    const key = rawKey.trim();
    if (!key) throw new Error('Enter a Gemini API key.');
    const vault = vaultRef.current;
    if (!vault) throw new Error('Sign in before managing API keys.');
    const existing = slots.find(slot => slot.slotId === slotId);

    if (!shouldPersistKey(isSessionOnly)) {
      if (existing && !existing.isSessionOnly && vault) await vault.removeKey(slotId);
      if (vault !== vaultRef.current) return;
      encryptedSlotIdsRef.current.delete(slotId);
      legacySlotIdsRef.current.delete(slotId);
    } else {
      const cryptoKey = cryptoKeyRef.current;
      if (!cryptoKey) throw new Error('Unlock or create the local key vault before saving a persistent key.');
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await CryptoUtils.encryptWithKey(key, cryptoKey, iv);
      if (vault !== vaultRef.current) return;
      const record: EncryptedKeyRecord = {
        slotId,
        label,
        maskedKey: CryptoUtils.maskKey(key),
        isEnabled: true,
        recordVersion: 2,
        ciphertextBase64: CryptoUtils.arrayBufferToBase64(ciphertext),
        ivBase64: CryptoUtils.arrayBufferToBase64(iv)
      };
      await vault.saveEncryptedKey(record);
      if (vault !== vaultRef.current) return;
      encryptedSlotIdsRef.current.add(slotId);
      legacySlotIdsRef.current.delete(slotId);
    }

    memoryKeysRef.current[slotId] = key;
    const maskedKey = CryptoUtils.maskKey(key);
    setLegacySlotIds([...legacySlotIdsRef.current].sort((a, b) => a - b));
    setSlots(previous => {
      const nextSlot: AiKeySlot = {
        slotId, label, maskedKey, isEnabled: true, isSessionOnly, status: 'untested'
      };
      const withoutCurrent = previous.filter(slot => slot.slotId !== slotId);
      return [...withoutCurrent, nextSlot].sort((a, b) => a.slotId - b.slotId);
    });
    if (shouldPersistKey(isSessionOnly)) {
      setVaultState(legacySlotIdsRef.current.size > 0 ? 'migration-required' : 'unlocked');
    } else if (encryptedSlotIdsRef.current.size === 0 && vault) {
      await vault.removeMetadata();
      if (vault !== vaultRef.current) return;
      cryptoKeyRef.current = null;
      setVaultState(legacySlotIdsRef.current.size > 0 ? 'migration-required' : 'unconfigured');
    }
  };

  const removeKey = async (slotId: number) => {
    const vault = vaultRef.current;
    const existing = slots.find(slot => slot.slotId === slotId);
    delete memoryKeysRef.current[slotId];
    if (existing && !existing.isSessionOnly && vault) await vault.removeKey(slotId);
    if (vault !== vaultRef.current) return;
    encryptedSlotIdsRef.current.delete(slotId);
    legacySlotIdsRef.current.delete(slotId);
    setLegacySlotIds([...legacySlotIdsRef.current].sort((a, b) => a - b));
    setSlots(previous => previous.filter(slot => slot.slotId !== slotId));
    if (encryptedSlotIdsRef.current.size === 0 && vault) {
      await vault.removeMetadata();
      if (vault !== vaultRef.current) return;
      cryptoKeyRef.current = null;
      setVaultState(legacySlotIdsRef.current.size > 0 ? 'migration-required' : 'unconfigured');
    }
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
    setVaultState(encryptedSlotIdsRef.current.size > 0
      ? (cryptoKeyRef.current ? 'unlocked' : 'locked')
      : 'unconfigured');
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
    if (slot && !slot.isSessionOnly && vault) {
      await vault.updateKeyEnabled(slotId, isEnabled);
    }
    if (vault !== vaultRef.current) return;
    setSlots(previous => previous.map(candidate => candidate.slotId === slotId ? { ...candidate, isEnabled } : candidate));
  };

  const getDecryptedKey = async (index: number): Promise<string | null> => {
    if (useE2eMocks) return index === 0 ? 'e2e-gemini-key' : null;
    const vault = vaultRef.current;
    const authGeneration = authGenerationRef.current;
    const slot = slots[index];
    if (!slot || (!slot.isSessionOnly && !cryptoKeyRef.current)) return null;
    setActiveKeyIndex(index);
    await new Promise(resolve => setTimeout(resolve, 100));
    if (vault !== vaultRef.current || authGeneration !== authGenerationRef.current) return null;
    return memoryKeysRef.current[slot.slotId] || null;
  };

  return (
    <AiKeysContext.Provider value={{
      slots,
      vaultState,
      legacySlotIds,
      setInitialPassphrase,
      unlockVault,
      lockVault,
      clearLegacyKeys,
      clearLocalVault,
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
