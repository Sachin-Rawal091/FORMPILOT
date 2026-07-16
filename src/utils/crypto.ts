import { logger } from './logger';

const KEY_ALGO = 'AES-GCM';
const KEY_LEN = 256;

// Retrieves or generates the stable AES key in chrome.storage.local
async function getOrCreateKey(): Promise<CryptoKey> {
  // If chrome.storage is not available (e.g. unit tests or server environment), return a dummy mock key
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    // Generate a temporary mock key in memory for tests
    const key = await crypto.subtle.generateKey(
      { name: KEY_ALGO, length: KEY_LEN },
      true,
      ['encrypt', 'decrypt']
    );
    return key;
  }

  const stored = await chrome.storage.local.get('fpDataKey');
  if (stored.fpDataKey && Array.isArray(stored.fpDataKey)) {
    try {
      return await crypto.subtle.importKey(
        'raw',
        new Uint8Array(stored.fpDataKey),
        KEY_ALGO,
        false,
        ['encrypt', 'decrypt']
      );
    } catch (err) {
      logger.error('Crypto', 'Failed to import stored key, regenerating:', err);
    }
  }

  // Generate a new key
  const key = await crypto.subtle.generateKey(
    { name: KEY_ALGO, length: KEY_LEN },
    true,
    ['encrypt', 'decrypt']
  );
  const raw = await crypto.subtle.exportKey('raw', key);
  await chrome.storage.local.set({ fpDataKey: Array.from(new Uint8Array(raw)) });
  return key;
}

export async function encryptValue(obj: any): Promise<{ iv: number[]; ct: number[] }> {
  try {
    const key = await getOrCreateKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(obj));
    const ctBuffer = await crypto.subtle.encrypt(
      { name: KEY_ALGO, iv },
      key,
      plaintext
    );
    return {
      iv: Array.from(iv),
      ct: Array.from(new Uint8Array(ctBuffer))
    };
  } catch (err) {
    logger.error('Crypto', 'Encryption failed:', err);
    throw err;
  }
}

export async function decryptValue(encrypted: { iv: number[]; ct: number[] }): Promise<any> {
  try {
    const key = await getOrCreateKey();
    const plainBuffer = await crypto.subtle.decrypt(
      { name: KEY_ALGO, iv: new Uint8Array(encrypted.iv) },
      key,
      new Uint8Array(encrypted.ct)
    );
    const plaintext = new TextDecoder().decode(plainBuffer);
    return JSON.parse(plaintext);
  } catch (err) {
    logger.error('Crypto', 'Decryption failed:', err);
    throw err;
  }
}

export async function encryptBuffer(buffer: ArrayBuffer): Promise<{ iv: number[]; ct: number[] }> {
  try {
    const key = await getOrCreateKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ctBuffer = await crypto.subtle.encrypt(
      { name: KEY_ALGO, iv },
      key,
      buffer
    );
    return {
      iv: Array.from(iv),
      ct: Array.from(new Uint8Array(ctBuffer))
    };
  } catch (err) {
    logger.error('Crypto', 'Buffer encryption failed:', err);
    throw err;
  }
}

export async function decryptBuffer(encrypted: { iv: number[]; ct: number[] }): Promise<ArrayBuffer> {
  try {
    const key = await getOrCreateKey();
    return await crypto.subtle.decrypt(
      { name: KEY_ALGO, iv: new Uint8Array(encrypted.iv) },
      key,
      new Uint8Array(encrypted.ct)
    );
  } catch (err) {
    logger.error('Crypto', 'Buffer decryption failed:', err);
    throw err;
  }
}
