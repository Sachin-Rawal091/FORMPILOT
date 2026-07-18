import { logger } from './logger';
import { getDB } from '../storage/db';

const KEY_ALGO = 'AES-GCM';
const KEY_LEN = 256;
const CURRENT_KEY_VERSION = 1;
const KEYS_STORE = 'keys';
const KEY_ID = 'fpDataKey';

export class KeyVersionMismatchError extends Error {
  constructor(found: number, expected: number) {
    super(`Encrypted record has keyVersion ${found}, current scheme is ${expected}.`);
    this.name = 'KeyVersionMismatchError';
  }
}

// Retrieves or generates a non-extractable AES-GCM key, stored directly as a
// CryptoKey object in IndexedDB (not chrome.storage.local — that tier is
// unencrypted disk storage, same as the ciphertext itself, so a key stored
// there provides no real protection). extractable:false means
// crypto.subtle.exportKey() throws for anyone, including this file, who
// tries to pull raw bytes out of it — it only ever exists as an opaque
// Web Crypto handle.
async function getOrCreateKey(): Promise<CryptoKey> {
  if (typeof indexedDB === 'undefined') {
    // Test/non-browser environment — ephemeral in-memory key only.
    return crypto.subtle.generateKey({ name: KEY_ALGO, length: KEY_LEN }, true, ['encrypt', 'decrypt']);
  }

  const db = await getDB();

  const existing = await db.get(KEYS_STORE, KEY_ID);
  if (existing) return existing as CryptoKey;

  const key = await crypto.subtle.generateKey(
    { name: KEY_ALGO, length: KEY_LEN },
    false, // extractable: false — this is the whole point
    ['encrypt', 'decrypt']
  );
  await db.put(KEYS_STORE, key, KEY_ID);
  return key;
}

export async function encryptValue(obj: any): Promise<{ keyVersion: number; iv: number[]; ct: number[] }> {
  try {
    const key = await getOrCreateKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(obj));
    const ctBuffer = await crypto.subtle.encrypt({ name: KEY_ALGO, iv }, key, plaintext);
    return {
      keyVersion: CURRENT_KEY_VERSION,
      iv: Array.from(iv),
      ct: Array.from(new Uint8Array(ctBuffer))
    };
  } catch (err) {
    logger.error('Crypto', 'Encryption failed:', err);
    throw err;
  }
}

export async function decryptValue(encrypted: { keyVersion?: number; iv: number[]; ct: number[] }): Promise<any> {
  // Unreachable today — no v2 scheme exists — but this guard means a future
  // scheme change fails loud and distinct instead of being silently treated
  // as "key is gone" and wiped by the recovery path.
  if (encrypted.keyVersion !== undefined && encrypted.keyVersion !== CURRENT_KEY_VERSION) {
    throw new KeyVersionMismatchError(encrypted.keyVersion, CURRENT_KEY_VERSION);
  }
  try {
    const key = await getOrCreateKey();
    const plainBuffer = await crypto.subtle.decrypt(
      { name: KEY_ALGO, iv: new Uint8Array(encrypted.iv) },
      key,
      new Uint8Array(encrypted.ct)
    );
    return JSON.parse(new TextDecoder().decode(plainBuffer));
  } catch (err) {
    logger.error('Crypto', 'Decryption failed:', err);
    throw err;
  }
}

export async function encryptBuffer(buffer: ArrayBuffer): Promise<{ keyVersion: number; iv: number[]; ct: number[] }> {
  try {
    const key = await getOrCreateKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ctBuffer = await crypto.subtle.encrypt({ name: KEY_ALGO, iv }, key, buffer);
    return {
      keyVersion: CURRENT_KEY_VERSION,
      iv: Array.from(iv),
      ct: Array.from(new Uint8Array(ctBuffer))
    };
  } catch (err) {
    logger.error('Crypto', 'Buffer encryption failed:', err);
    throw err;
  }
}

export async function decryptBuffer(encrypted: { keyVersion?: number; iv: number[]; ct: number[] }): Promise<ArrayBuffer> {
  if (encrypted.keyVersion !== undefined && encrypted.keyVersion !== CURRENT_KEY_VERSION) {
    throw new KeyVersionMismatchError(encrypted.keyVersion, CURRENT_KEY_VERSION);
  }
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
