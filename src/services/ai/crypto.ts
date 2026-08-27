// Web Crypto API helpers for secure device-local storage

export const CryptoUtils = {
  // Convert base64 to Uint8Array
  base64ToArrayBuffer(base64: string): Uint8Array {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes;
  },

  // Convert Uint8Array to base64
  arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  },

  async deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 250000, // Strong iteration count
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },

  async encryptSecret(secret: string, passphrase: string): Promise<{ ciphertextBase64: string, ivBase64: string, saltBase64: string }> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const key = await this.deriveKey(passphrase, salt);
    
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(secret)
    );

    return {
      ciphertextBase64: this.arrayBufferToBase64(ciphertext),
      ivBase64: this.arrayBufferToBase64(iv),
      saltBase64: this.arrayBufferToBase64(salt),
    };
  },

  async decryptSecret(ciphertextBase64: string, ivBase64: string, saltBase64: string, passphrase: string): Promise<string> {
    const salt = this.base64ToArrayBuffer(saltBase64);
    const iv = this.base64ToArrayBuffer(ivBase64);
    const ciphertext = this.base64ToArrayBuffer(ciphertextBase64);

    const key = await this.deriveKey(passphrase, salt);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    const dec = new TextDecoder();
    return dec.decode(decryptedBuffer);
  },

  maskKey(secret: string): string {
    if (!secret || secret.length < 8) return '****';
    return `AIza...${secret.substring(secret.length - 4)}`;
  },

  redactString(text: string): string {
    // Redact Gemini API keys (starts with AIza and is 39 chars long)
    return text.replace(/AIza[a-zA-Z0-9-_]{35}/g, '[REDACTED_KEY]');
  }
};
