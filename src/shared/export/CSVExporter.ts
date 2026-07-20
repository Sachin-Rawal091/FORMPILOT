/**
 * CSVExporter — Generates CSV files from RowResult[] data.
 * 
 * Handles:
 * - Results Report CSV (all rows with metadata)
 * - Failed Rows Re-upload CSV (failed/skipped rows, data-only columns)
 * - Proper RFC 4180 escaping + CSV injection prevention (Recommendation #10)
 * - Error truncation for CSV (Recommendation #11)
 * - UTF-8 BOM for Excel compatibility (Recommendation #16)
 */

import {
  RowResult,
  RowResultStatus,
  ROW_STATUS_LABELS,
  CSVExportConfig,
  DEFAULT_CSV_CONFIG,
} from './types';
import {
  escapeCSV,
  truncateText,
  downloadFile,
  generateExportFilename,
  UTF8_BOM,
} from './ExportUtils';
import { logger } from '../../utils/logger';

export class CSVExporter {
  /**
   * Generate and download a Results Report CSV.
   * 
   * Column order: Row # | [form data columns] | Timestamp | Status | Retries | Duration (ms) | Warning | Error
   * Error is always last because it can contain long text (Recommendation #11).
   * 
   * @param results - Aggregated RowResult[] from RowResultAggregator
   * @param headers - Excel column headers in original order
   * @param workflowName - Name of the workflow for filename generation
   * @param config - Optional CSV configuration overrides
   */
  static downloadResultsReport(
    results: RowResult[],
    headers: string[],
    workflowName: string,
    config: CSVExportConfig = DEFAULT_CSV_CONFIG
  ): void {
    const csvContent = this.generateResultsCSV(results, headers, config);
    const filename = generateExportFilename('formpilot_results', workflowName, 'csv');
    
    logger.info('CSVExporter', `Results CSV exported: ${results.length} rows, ${headers.length + 6} columns`);
    downloadFile(csvContent, filename, 'text/csv');
  }

  /**
   * Generate and download a Failed Rows Re-upload CSV.
   * 
   * Only includes rows with FAILED, SKIPPED, or NOT_STARTED status.
   * Only includes form data columns (no metadata) — ready for direct re-upload.
   * 
   * @param results - Aggregated RowResult[] from RowResultAggregator
   * @param headers - Excel column headers in original order
   * @param workflowName - Name of the workflow for filename generation
   */
  static downloadFailedRows(
    results: RowResult[],
    headers: string[],
    workflowName: string
  ): void {
    const failedResults = results.filter(
      r => r.status === RowResultStatus.FAILED ||
           r.status === RowResultStatus.SKIPPED ||
           r.status === RowResultStatus.NOT_STARTED
    );

    if (failedResults.length === 0) {
      logger.info('CSVExporter', 'No failed rows to export');
      return;
    }

    const csvContent = this.generateFailedRowsCSV(failedResults, headers);
    const filename = generateExportFilename('formpilot_failed_rows', workflowName, 'csv');
    
    logger.info('CSVExporter', `Failed rows CSV exported: ${failedResults.length} rows`);
    downloadFile(csvContent, filename, 'text/csv');
  }

  /**
   * Generate and download step-level diagnostic logs as CSV.
   * This preserves the existing step-level export for power users.
   */
  static downloadStepLogs(
    logs: Array<{
      timestamp: number;
      rowIndex: number;
      action: number | string;
      selector: string;
      value?: string;
      status: string;
      error?: string;
      duration: number;
      retryCount: number;
    }>,
    workflowName: string
  ): void {
    const metaHeaders = ['Timestamp', 'Row Index', 'Action', 'Selector', 'Value', 'Status', 'Retries', 'Error', 'Duration (ms)'];
    
    const rows = logs.map(log => [
      escapeCSV(new Date(log.timestamp).toISOString()),
      escapeCSV(log.rowIndex),
      escapeCSV(log.action),
      escapeCSV(log.selector),
      escapeCSV(log.value),
      escapeCSV(log.status),
      escapeCSV(log.retryCount ?? 0),
      escapeCSV(log.error),
      escapeCSV(log.duration ?? 0),
    ]);

    const csvLines = [metaHeaders.join(','), ...rows.map(r => r.join(','))];
    const csvContent = UTF8_BOM + csvLines.join('\n');
    const filename = generateExportFilename('formpilot_step_logs', workflowName, 'csv');

    logger.info('CSVExporter', `Step logs CSV exported: ${logs.length} entries`);
    downloadFile(csvContent, filename, 'text/csv');
  }

  // --- Internal CSV generation methods ---

  /**
   * Generate the Results Report CSV content string.
   */
  private static generateResultsCSV(
    results: RowResult[],
    headers: string[],
    config: CSVExportConfig
  ): string {
    // Build header row: Row # | [form data columns] | Timestamp | Status | Retries | Duration (ms) | Warning | Error
    const csvHeaders = [
      'Row #',
      ...headers,
      'Timestamp',
      'Status',
      'Retries',
      'Duration (ms)',
      'Warning',
      'Error'
    ];

    // Build data rows
    const csvRows = results.map(row => {
      const formDataCells = headers.map(header => escapeCSV(row.data[header]));
      
      return [
        escapeCSV(row.rowNumber),
        ...formDataCells,
        escapeCSV(row.timestamp),
        escapeCSV(ROW_STATUS_LABELS[row.status]),
        escapeCSV(row.retries),
        escapeCSV(row.durationMs),
        escapeCSV(truncateText(row.warning, config.maxWarningLength)),
        escapeCSV(truncateText(row.error, config.maxErrorLength)),  // Error last (Recommendation #11)
      ];
    });

    // Assemble CSV with BOM
    const lines = [csvHeaders.join(','), ...csvRows.map(r => r.join(','))];
    return (config.includeBOM ? UTF8_BOM : '') + lines.join('\n');
  }

  /**
   * Generate the Failed Rows Re-upload CSV content string.
   * Data-only columns — no metadata — ready for direct re-upload into FormPilot.
   */
  private static generateFailedRowsCSV(
    results: RowResult[],
    headers: string[]
  ): string {
    const csvRows = results.map(row =>
      headers.map(header => escapeCSV(row.data[header]))
    );

    const lines = [headers.join(','), ...csvRows.map(r => r.join(','))];
    return UTF8_BOM + lines.join('\n');
  }
}
