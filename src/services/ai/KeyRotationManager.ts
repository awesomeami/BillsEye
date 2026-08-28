import { AiKeySlot, AiRequestError } from '../../domain/aiTypes';

export class KeyRotationManager {
  private slots: AiKeySlot[] = [];
  private lastUsedIndex = -1;
  private onSlotsChanged?: (slots: AiKeySlot[]) => void;

  setOnSlotsChanged(callback: (slots: AiKeySlot[]) => void) {
    this.onSlotsChanged = callback;
  }

  updateSlots(slots: AiKeySlot[]) {
    // Only update if it's from the external world (e.g. user added a key)
    this.slots = slots;
  }

  private _updateSlot(index: number, updater: (slot: AiKeySlot) => AiKeySlot) {
    if (!this.slots[index]) return;
    const newSlots = [...this.slots];
    newSlots[index] = updater(this.slots[index]);
    this.slots = newSlots;
    if (this.onSlotsChanged) {
      this.onSlotsChanged(this.slots);
    }
  }

  getEligibleKeyIndex(): number {
    const now = Date.now();
    
    // Find all enabled keys
    const enabledSlots = this.slots
      .map((slot, index) => ({ slot, index }))
      .filter(s => s.slot.isEnabled && s.slot.status !== 'invalid');
      
    if (enabledSlots.length === 0) {
      return -1; // No eligible keys
    }

    // Try to find a healthy key round-robin style through ELIGIBLE keys
    for (let i = 1; i <= enabledSlots.length; i++) {
      // Find where we were in the enabled list
      const lastEnabledIndex = enabledSlots.findIndex(s => s.index === this.lastUsedIndex);
      const start = lastEnabledIndex !== -1 ? lastEnabledIndex : -1;
      
      const enabledIdx = (start + i) % enabledSlots.length;
      const { slot, index } = enabledSlots[enabledIdx];
      
      if (!slot.cooldownUntil || slot.cooldownUntil < now) {
        this.lastUsedIndex = index;
        return index;
      }
    }

    // If all enabled keys are on cooldown, we must wait. 
    return -2; 
  }

  getEarliestRetryTime(): number | null {
    const now = Date.now();
    const cooldowns = this.slots
      .filter(s => s.isEnabled && s.status !== 'invalid' && s.cooldownUntil && s.cooldownUntil > now)
      .map(s => s.cooldownUntil!);
      
    if (cooldowns.length === 0) return null;
    return Math.min(...cooldowns);
  }

  handleSuccess(index: number) {
    this._updateSlot(index, s => ({
      ...s,
      status: 'healthy',
      cooldownUntil: undefined,
      lastSuccessAt: Date.now(),
      failureCount: 0
    }));
  }

  handleError(index: number, error: AiRequestError) {
    const now = Date.now();
    this._updateSlot(index, s => {
      const failureCount = (s.failureCount || 0) + 1;
      const newSlot = { ...s, failureCount };
      
      switch (error.code) {
        case 'rate_limit': {
          const baseCooldown = error.retryAfterMs || Math.min(30000 * Math.pow(2, failureCount - 1), 5 * 60 * 1000);
          const jitter = Math.floor(Math.random() * 5000);
          newSlot.status = 'cooldown';
          newSlot.cooldownUntil = now + baseCooldown + jitter;
          break;
        }
        case 'network_error': {
          newSlot.status = 'cooldown';
          newSlot.cooldownUntil = now + Math.min(15000 * Math.pow(2, failureCount - 1), 60000) + Math.floor(Math.random() * 5000);
          break;
        }
        case 'auth_failed':
          newSlot.status = 'invalid';
          newSlot.cooldownUntil = undefined;
          break;
        case 'bad_request':
        case 'cancelled':
          // No penalty
          break;
        default:
          newSlot.status = 'cooldown';
          newSlot.cooldownUntil = now + 10000;
          break;
      }
      return newSlot;
    });
  }

  getEligibleCount(): number {
    return this.slots.filter(s => s.isEnabled && s.status !== 'invalid').length;
  }

  getSlotsForTesting(): readonly AiKeySlot[] {
    return this.slots;
  }
}
