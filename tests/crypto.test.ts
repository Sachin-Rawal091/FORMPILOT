import { describe, it, expect } from 'vitest';
import { encryptValue, decryptValue, encryptBuffer, decryptBuffer, KeyVersionMismatchError } from '../src/utils/crypto';

describe('crypto', () => {
  it('should encrypt and decrypt a value round-trip losslessly', async () => {
    const original = { name: 'Sachin', amount: 1234.5, nested: { ok: true } };
    const encrypted = await encryptValue(original);
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.iv.length).toBe(12);
    expect(encrypted.ct.length).toBeGreaterThan(0);

    const decrypted = await decryptValue(encrypted);
    expect(decrypted).toEqual(original);
  });

  it('should produce different ciphertext for the same value on repeated calls (random IV)', async () => {
    const a = await encryptValue({ x: 1 });
    const b = await encryptValue({ x: 1 });
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ct).not.toEqual(b.ct);
  });

  it('should round-trip an ArrayBuffer via encryptBuffer/decryptBuffer', async () => {
    const original = new TextEncoder().encode('binary file contents, e.g. a PDF upload').buffer;
    const encrypted = await encryptBuffer(original);
    const decrypted = await decryptBuffer(encrypted);
    expect(new Uint8Array(decrypted)).toEqual(new Uint8Array(original));
  });

  it('should throw KeyVersionMismatchError for a future/unknown keyVersion', async () => {
    const encrypted = await encryptValue({ x: 1 });
    const tampered = { ...encrypted, keyVersion: 99 };
    await expect(decryptValue(tampered)).rejects.toThrow(KeyVersionMismatchError);
  });

  it('should throw when ciphertext is corrupted (tamper detection via GCM auth tag)', async () => {
    const encrypted = await encryptValue({ x: 1 });
    const corrupted = { ...encrypted, ct: encrypted.ct.map((b, i) => (i === 0 ? b ^ 0xff : b)) };
    await expect(decryptValue(corrupted)).rejects.toThrow();
  });
});
