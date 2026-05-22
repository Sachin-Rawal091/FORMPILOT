import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import { ExcelDataEngine } from '../src/utils/ExcelDataEngine';
import { RowStatus } from '../src/types';

vi.mock('xlsx', async (importOriginal) => {
  const original = await importOriginal<typeof import('xlsx')>();
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

    it('should match fuzzy columns with Levenshtein distance <= 2', () => {
      expect(ExcelDataEngine.fuzzyMatchColumn('Full Nami', available)).toBe('Full Name');
      expect(ExcelDataEngine.fuzzyMatchColumn('Email Addr', available)).toBeNull();
      expect(ExcelDataEngine.fuzzyMatchColumn('Phone Number', available)).toBe('PhoneNumber');
    });

    it('should return null for empty/null targets or empty available columns', () => {
      expect(ExcelDataEngine.fuzzyMatchColumn('', available)).toBeNull();
      expect(ExcelDataEngine.fuzzyMatchColumn('Age', [])).toBeNull();
    });
  });
});
