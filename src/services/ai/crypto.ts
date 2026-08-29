// Helpers for handling device-local key display and diagnostics.

export const CryptoUtils = {
  maskKey(secret: string): string {
    if (!secret || secret.length < 8) return '****';
    return `AIza...${secret.substring(secret.length - 4)}`;
  },

  redactString(text: string): string {
    // Redact the complete key-shaped token, including malformed or future-length values.
    return text.replace(/AIza[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]');
  }
};
