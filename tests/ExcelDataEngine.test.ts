import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { ExcelDataEngine } from '../src/utils/ExcelDataEngine';
import { RowStatus } from '../src/types';
import { normalizeCellValue, sanitizeObjectKey } from '../src/utils/sanitize';

vi.mock('@e965/xlsx', async (importOriginal) => {
  const original = await importOriginal<typeof import('@e965/xlsx')>();
  return {
    ...original,
    read: (data: any, opts: any) => {
      if (data && data.byteLength === 999) { // specific signature for mock empty
        return { SheetNames: [], Sheets: {} };
      }
      return original.read(data, opts);
    }
  };
});

describe('ExcelDataEngine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseExcelFile', () => {
    it('should parse a valid Excel workbook into structured ExcelRow entries', async () => {
      const rows = [
        { Name: 'Sachin', Email: 'sachin@example.com', Age: 30 },
        { Name: 'Rawal', Email: 'rawal@example.com', Age: 25 }
      ];

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const parsed = await ExcelDataEngine.parseExcelFile(buffer);

      expect(parsed).toHaveLength(2);
      expect(parsed[0].rowIndex).toBe(2);
      expect(parsed[0].data).toEqual({ Name: 'Sachin', Email: 'sachin@example.com', Age: 30 });
      expect(parsed[0].status).toBe(RowStatus.PENDING);
      expect(parsed[0].isValid).toBe(true);

      expect(parsed[1].rowIndex).toBe(3);
      expect(parsed[1].data).toEqual({ Name: 'Rawal', Email: 'rawal@example.com', Age: 25 });
    });

    it('should skip rows that exceed the empty-column threshold', async () => {
      const rows = [
        { Name: 'Sachin', Email: 'sachin@example.com', Age: '30' },
        { Name: 'Rawal', Email: null, Age: null },
        { Name: null, Email: null, Age: null }
      ];

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const parsed = await ExcelDataEngine.parseExcelFile(buffer);

      expect(parsed).toHaveLength(2);
      expect(parsed[0].data.Name).toBe('Sachin');
      expect(parsed[1].data.Name).toBe('Rawal');
    });

    it('should preserve safe text while sanitizing unsafe keys and control characters', async () => {
      const ws = XLSX.utils.aoa_to_sheet([
        ['Company', 'Bio', '__proto__', 'constructor', 'prototype'],
        ['AT&T <Acme>', 'Line\r\nTwo\u0000', 'polluted', 'bad', 'bad']
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const parsed = await ExcelDataEngine.parseExcelFile(buffer);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].data.Company).toBe('AT&T <Acme>');
      expect(parsed[0].data.Bio).toBe('Line\nTwo');
      expect(Object.prototype.hasOwnProperty.call(parsed[0].data, '__proto__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(parsed[0].data, 'constructor')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(parsed[0].data, 'prototype')).toBe(false);
    });

    it('should strip UTF-8 BOM characters from CSV headers', async () => {
      const bomCsvString = '\uFEFFFull Name,Email\nJohn Doe,john@example.com';
      const encoder = new TextEncoder();
      const buffer = encoder.encode(bomCsvString).buffer;

      const parsed = await ExcelDataEngine.parseExcelFile(buffer);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].data['Full Name']).toBe('John Doe');
      expect(Object.keys(parsed[0].data)).toContain('Full Name');
      expect(Object.keys(parsed[0].data)[0]).not.toContain('\uFEFF');
    });

    it('should throw an error if the workbook has no sheets', async () => {
      // Pass the 999-byte empty buffer to trigger our mock in read()
      const fakeBuffer = new ArrayBuffer(999);
      await expect(ExcelDataEngine.parseExcelFile(fakeBuffer)).rejects.toThrow("Excel file contains no sheets.");
    });
  });

  describe('fuzzyMatchColumn', () => {
    const available = ['Full Name', 'Email Address', 'PhoneNumber', 'Age'];

    it('should perform a exact case-insensitive match (with trimming)', () => {
      expect(ExcelDataEngine.fuzzyMatchColumn('age', available)).toBe('Age');
      expect(ExcelDataEngine.fuzzyMatchColumn('  EMAIL ADDRESS  ', available)).toBe('Email Address');
    });

    it('should return null for empty/null targets or empty available columns', () => {
      expect(ExcelDataEngine.fuzzyMatchColumn('', available)).toBeNull();
      expect(ExcelDataEngine.fuzzyMatchColumn('Age', [])).toBeNull();
    });
  });

  describe('sanitization helpers', () => {
    it('should reject unsafe object keys and preserve legitimate display characters', () => {
      expect(sanitizeObjectKey('__proto__')).toBeNull();
      expect(sanitizeObjectKey('constructor')).toBeNull();
      expect(sanitizeObjectKey(' Company ')).toBe('Company');
      expect(normalizeCellValue('AT&T <Acme>\u0000')).toBe('AT&T <Acme>');
    });
  });
});
