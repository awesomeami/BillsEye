// Web Crypto API helpers for secure device-local storage

export const CryptoUtils = {
  // Convert base64 to Uint8Array
  base64ToArrayBuffer(base64: string): Uint8Array {
    const binary_string = globalThis.atob(base64);
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
    return globalThis.btoa(binary);
  },

  generateSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(16));
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
    const salt = this.generateSalt();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const key = await this.deriveKey(passphrase, salt);
    
    const ciphertext = await this.encryptWithKey(secret, key, iv);

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

    return this.decryptWithKey(ciphertext, key, iv);
  },

  async encryptWithKey(secret: string, key: CryptoKey, iv = crypto.getRandomValues(new Uint8Array(12))): Promise<ArrayBuffer> {
    const enc = new TextEncoder();
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(secret));
  },

  async decryptWithKey(ciphertext: ArrayBuffer | Uint8Array, key: CryptoKey, iv: Uint8Array): Promise<string> {
    const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(decryptedBuffer);
  },

  maskKey(secret: string): string {
    if (!secret || secret.length < 8) return '****';
    return `AIza...${secret.substring(secret.length - 4)}`;
  },

  redactString(text: string): string {
    // Redact the complete key-shaped token, including malformed or future-length values.
    return text.replace(/AIza[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]');
  }
};
