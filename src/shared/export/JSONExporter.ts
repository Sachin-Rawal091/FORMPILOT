/**
 * JSONExporter — Generates enriched JSON exports from RowResult[] data.
 * 
 * Produces a self-documenting ExportEnvelope with:
 * - Export metadata (timestamp, version, workflow name)
 * - Summary counters
 * - Nested row results with per-step detail (Recommendation #12)
 * 
 * JSON exports keep full error messages (no truncation, unlike CSV).
 */

import {
  RowResult,
  RowResultStatus,
  ROW_STATUS_LABELS,
  ExportEnvelope,
} from './types';
import { RowResultAggregator } from './RowResultAggregator';
import { downloadFile, generateExportFilename } from './ExportUtils';
import { logger } from '../../utils/logger';

/** Current export format version — bump on breaking schema changes */
const EXPORT_VERSION = '1.0';

export class JSONExporter {
  /**
   * Generate and download an enriched Results Report JSON.
   * 
   * Output structure (Recommendation #12 + #18):
   * ```json
   * {
   *   "exportedAt": "...",
   *   "exportVersion": "1.0",
   *   "workflowName": "...",
   *   "sessionId": "...",
   *   "summary": { totalRows, success, failed, ... },
   *   "rows": [
   *     {
   *       "rowNumber": 1,
   *       "data": { ... },
   *       "summary": { status, retries, durationMs },
   *       "steps": [ { field, strategy, confidence, duration, ... } ]
   *     }
   *   ]
   * }
   * ```
   */
  static downloadResultsReport(
    results: RowResult[],
    workflowName: string,
    sessionId: string
  ): void {
    const envelope = this.generateEnvelope(results, workflowName, sessionId);
    const jsonString = JSON.stringify(envelope, null, 2);
    const filename = generateExportFilename('formpilot_results', workflowName, 'json');

    logger.info('JSONExporter', `Results JSON exported: ${results.length} rows, ${(jsonString.length / 1024).toFixed(1)}KB`);
    downloadFile(jsonString, filename, 'application/json');
  }

  /**
   * Generate and download step-level diagnostic logs as JSON.
   * This preserves the existing step-level export for power users.
   */
  static downloadStepLogs(
    logs: Array<Record<string, unknown>>,
    workflowName: string,
    sessionId: string
  ): void {
    const envelope = {
      exportedAt: new Date().toISOString(),
      exportVersion: EXPORT_VERSION,
      workflowName,
      sessionId,
      type: 'step-level-diagnostics',
      totalEntries: logs.length,
      logs,
    };

    const jsonString = JSON.stringify(envelope, null, 2);
    const filename = `formpilot_step_logs_${sessionId.slice(0, 8)}.json`;

    logger.info('JSONExporter', `Step logs JSON exported: ${logs.length} entries`);
    downloadFile(jsonString, filename, 'application/json');
  }

  // --- Internal generation methods ---

  /**
   * Build the ExportEnvelope wrapping all row results.
   */
  private static generateEnvelope(
    results: RowResult[],
    workflowName: string,
    sessionId: string
  ): ExportEnvelope {
    const summary = RowResultAggregator.computeSummary(results);

    return {
      exportedAt: new Date().toISOString(),
      exportVersion: EXPORT_VERSION,
      workflowName,
      sessionId,
      summary,
      rows: results.map(row => ({
        ...row,
        // Convert status enum to readable label for JSON consumers
        status: ROW_STATUS_LABELS[row.status] as unknown as RowResultStatus,
      })),
    };
  }
}
