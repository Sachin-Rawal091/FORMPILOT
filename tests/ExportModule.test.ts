import { describe, it, expect } from 'vitest';
import { RowResultAggregator } from '../src/shared/export/RowResultAggregator';
import { CSVExporter } from '../src/shared/export/CSVExporter';
import { JSONExporter } from '../src/shared/export/JSONExporter';
import { escapeCSV, truncateText, sanitizeFilename, generateExportFilename, formatDuration } from '../src/shared/export/ExportUtils';
import { RowResultStatus } from '../src/shared/export/types';
import { LogEntry, ExcelRow, RowStatus, Action } from '../src/types';

describe('Export Module', () => {
  describe('ExportUtils', () => {
    it('should escape CSV fields correctly according to RFC 4180', () => {
      expect(escapeCSV(null)).toBe('');
      expect(escapeCSV(undefined)).toBe('');
      expect(escapeCSV('simple')).toBe('simple');
      expect(escapeCSV('Hello, World')).toBe('"Hello, World"');
      expect(escapeCSV('He said "hello"')).toBe('"He said ""hello"""');
      expect(escapeCSV('Line1\nLine2')).toBe('"Line1\nLine2"');
    });

    it('should guard against CSV injection formulas starting with =, +, -, @', () => {
      expect(escapeCSV('=SUM(A1:A10)')).toBe('"\'=SUM(A1:A10)"');
      expect(escapeCSV('+cmd|')).toBe('"\'+cmd|"');
      expect(escapeCSV('-100')).toBe('"\'-100"');
      expect(escapeCSV('@admin')).toBe('"\'@admin"');
    });

    it('should truncate long strings safely', () => {
      expect(truncateText('Short text', 20)).toBe('Short text');
      expect(truncateText('This is a very long error text', 15)).toBe('This is a ve...');
      expect(truncateText('', 10)).toBe('');
    });

    it('should sanitize filenames across operating systems', () => {
      expect(sanitizeFilename('KRP Registration / Portal')).toBe('KRP_Registration_Portal');
      expect(sanitizeFilename('Test <File> : Name?')).toBe('Test_File_Name');
      expect(sanitizeFilename('  Spaced  Name  ')).toBe('Spaced_Name');
    });

    it('should generate timestamped export filenames', () => {
      const filename = generateExportFilename('formpilot_results', 'My Workflow', 'csv');
      expect(filename).toMatch(/^formpilot_results_My_Workflow_\d{4}-\d{2}-\d{2}\.csv$/);
    });

    it('should format duration in milliseconds cleanly', () => {
      expect(formatDuration(450)).toBe('450ms');
      expect(formatDuration(2500)).toBe('2.5s');
      expect(formatDuration(125000)).toBe('2m 5s');
    });
  });

  describe('RowResultAggregator', () => {
    const mockExcelRows: ExcelRow[] = [
      {
        rowIndex: 2,
        data: { 'Full Name': 'John Doe', Email: 'john@example.com' },
        status: RowStatus.PENDING,
        isValid: true,
        validationErrors: []
      },
      {
        rowIndex: 3,
        data: { 'Full Name': 'Jane Smith', Email: 'jane@example.com' },
        status: RowStatus.PENDING,
        isValid: true,
        validationErrors: []
      },
      {
        rowIndex: 4,
        data: { 'Full Name': 'Bob Wilson', Email: 'bob@example.com' },
        status: RowStatus.PENDING,
        isValid: true,
        validationErrors: []
      }
    ];

    const mockLogs: LogEntry[] = [
      {
        id: '1',
        sessionId: 'sess-1',
        timestamp: 1700000000000,
        rowIndex: 2,
        stepId: 'step-1',
        action: Action.FILL,
        selector: '#name',
        value: 'John Doe',
        result: 0,
        status: 'FILLED',
        retryCount: 0,
        duration: 150
      },
      {
        id: '2',
        sessionId: 'sess-1',
        timestamp: 1700000000200,
        rowIndex: 2,
        stepId: 'step-2',
        action: Action.FILL,
        selector: '#email',
        value: 'john@example.com',
        result: 0,
        status: 'FILLED',
        retryCount: 0,
        duration: 120
      },
      {
        id: '3',
        sessionId: 'sess-1',
        timestamp: 1700000001000,
        rowIndex: 3,
        stepId: 'step-1',
        action: Action.FILL,
        selector: '#name',
        value: 'Jane Smith',
        result: 1,
        status: 'FAILED',
        error: 'Element #name not found',
        retryCount: 2,
        duration: 5000
      }
    ];

    it('should aggregate step logs into row-level results in original Excel order', () => {
      const results = RowResultAggregator.aggregate(mockLogs, mockExcelRows);

      expect(results).toHaveLength(3);
      
      // Row 1 (Excel rowIndex 2) — SUCCESS
      expect(results[0].rowNumber).toBe(1);
      expect(results[0].rowIndex).toBe(2);
      expect(results[0].status).toBe(RowResultStatus.SUCCESS);
      expect(results[0].durationMs).toBe(270);
      expect(results[0].retries).toBe(0);
      expect(results[0].data['Full Name']).toBe('John Doe');

      // Row 2 (Excel rowIndex 3) — FAILED
      expect(results[1].rowNumber).toBe(2);
      expect(results[1].rowIndex).toBe(3);
      expect(results[1].status).toBe(RowResultStatus.FAILED);
      expect(results[1].durationMs).toBe(5000);
      expect(results[1].retries).toBe(2);
      expect(results[1].error).toContain('Element #name not found');

      // Row 3 (Excel rowIndex 4) — NOT_STARTED (unexecuted row)
      expect(results[2].rowNumber).toBe(3);
      expect(results[2].rowIndex).toBe(4);
      expect(results[2].status).toBe(RowResultStatus.NOT_STARTED);
      expect(results[2].durationMs).toBe(0);
      expect(results[2].retries).toBe(0);
    });

    it('should compute summary counters accurately', () => {
      const results = RowResultAggregator.aggregate(mockLogs, mockExcelRows);
      const summary = RowResultAggregator.computeSummary(results);

      expect(summary.totalRows).toBe(3);
      expect(summary.success).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.notStarted).toBe(1);
      expect(summary.totalDurationMs).toBe(5270);
      expect(summary.totalRetries).toBe(2);
    });
  });

  describe('CSVExporter & JSONExporter', () => {
    it('should export Results Report CSV with UTF-8 BOM and correct columns', () => {
      const results = RowResultAggregator.aggregate([], []);
      expect(() => {
        CSVExporter.downloadResultsReport(results, ['Name', 'Email'], 'Test Workflow');
      }).not.toThrow();
    });

    it('should export JSON Results Report with envelope structure', () => {
      const results = RowResultAggregator.aggregate([], []);
      expect(() => {
        JSONExporter.downloadResultsReport(results, 'Test Workflow', 'sess-123');
      }).not.toThrow();
    });
  });
});
