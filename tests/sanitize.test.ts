import { describe, it, expect } from 'vitest';
import { sanitizeTextValue, sanitizeObjectKey, normalizeCellValue, sanitizeLogText } from '../src/utils/sanitize';

describe('sanitize', () => {
  describe('sanitizeTextValue', () => {
    it('should strip control characters but keep normal text', () => {
      expect(sanitizeTextValue('Hello\x00World\x1F!')).toBe('HelloWorld!');
    });
    it('should normalize CRLF to LF', () => {
      expect(sanitizeTextValue('line1\r\nline2')).toBe('line1\nline2');
    });
  });

  describe('sanitizeObjectKey', () => {
    it('should reject prototype-pollution keys case-insensitively', () => {
      expect(sanitizeObjectKey('__proto__')).toBeNull();
      expect(sanitizeObjectKey('Prototype')).toBeNull();
      expect(sanitizeObjectKey('CONSTRUCTOR')).toBeNull();
    });
    it('should reject empty/whitespace-only keys', () => {
      expect(sanitizeObjectKey('   ')).toBeNull();
    });
    it('should pass through and trim normal Excel header keys', () => {
      expect(sanitizeObjectKey('  Applicant Name  ')).toBe('Applicant Name');
    });
  });

  describe('normalizeCellValue', () => {
    it('should return null for null/undefined', () => {
      expect(normalizeCellValue(null)).toBeNull();
      expect(normalizeCellValue(undefined)).toBeNull();
    });
    it('should pass through finite numbers, null out NaN/Infinity', () => {
      expect(normalizeCellValue(42)).toBe(42);
      expect(normalizeCellValue(Infinity)).toBeNull();
    });
    it('should ISO-stringify valid Dates and null out invalid ones', () => {
      const d = new Date('2026-01-15T00:00:00.000Z');
      expect(normalizeCellValue(d)).toBe(d.toISOString());
      expect(normalizeCellValue(new Date('invalid'))).toBeNull();
    });
    it('should string-coerce and sanitize other types', () => {
      expect(normalizeCellValue(true)).toBe(true);
    });
  });

  describe('sanitizeLogText', () => {
    it('should return undefined for null/undefined input (not the string "undefined")', () => {
      expect(sanitizeLogText(null)).toBeUndefined();
      expect(sanitizeLogText(undefined)).toBeUndefined();
    });
    it('should coerce and sanitize non-string values', () => {
      expect(sanitizeLogText(404)).toBe('404');
    });
  });
});
