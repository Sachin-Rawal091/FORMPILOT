/**
 * RowResultAggregator — Single source of truth for row-level execution results.
 * 
 * Aggregates step-level LogEntry[] into per-row RowResult[] by:
 * 1. Iterating Excel rows in ORIGINAL order (Recommendation #8)
 * 2. Looking up logs per row (not iterating logs first)
 * 3. Computing status via priority enum (Recommendation #3)
 * 4. Handling missing logs as NOT_STARTED (Recommendation #9)
 * 5. Null-guarding duration (Recommendation #5)
 * 
 * Every consumer (CSV, JSON, Failed Rows, future PDF) uses this same RowResult[].
 */

import { LogEntry, ExcelRow, Action, SelectorStrategy, Step } from '../../types';
import {
  RowResult,
  RowResultStatus,
  StepDetail,
  ExportSummary,
} from './types';

/**
 * Map a LogEntry status string to a RowResultStatus priority value.
 * Higher = worse. Row status = max(stepStatuses).
 */
function logStatusToPriority(status: string): RowResultStatus {
  switch (status) {
    case 'FILLED':
    case 'FILLED_DEFAULT':
    case 'FILLED_COERCED':
    case 'SUCCESS':
      return RowResultStatus.SUCCESS;

    case 'WARN':
    case 'RETRIED':
      return RowResultStatus.WARNING;

    case 'STEP_SKIPPED':
      // A single skipped step doesn't make the row "SKIPPED".
      // Only if ALL steps are skipped (handled at row level).
      return RowResultStatus.SUCCESS;

    case 'ROW_SKIPPED':
    case 'CAPTCHA_DETECTED':
      return RowResultStatus.SKIPPED;

    case 'FAILED':
      return RowResultStatus.FAILED;

    default:
      return RowResultStatus.WARNING;
  }
}

/**
 * Determine if a log status represents a warning worth including in the warning column.
 */
function isWarningStatus(status: string): boolean {
  return status === 'WARN' || status === 'RETRIED' || status === 'CAPTCHA_DETECTED';
}

/**
 * Determine if a log status represents an error worth including in the error column.
 */
function isErrorStatus(status: string): boolean {
  return status === 'FAILED' || status === 'ROW_SKIPPED';
}

/**
 * Build a human-readable field name from a step's selector metadata.
 */
function getFieldName(log: LogEntry, stepsMap?: Map<string, Step>): string {
  const step = stepsMap?.get(log.stepId);
  if (step?.selectorMeta) {
    const meta = step.selectorMeta;
    const label = meta.labelText || meta.placeholder || meta.ariaLabel || meta.name || '';
    if (label.trim()) return label.trim();
  }
  // Fallback to selector (truncated)
  return log.selector.length > 60 ? log.selector.slice(0, 57) + '...' : log.selector;
}

/**
 * Get the human-readable name for a SelectorStrategy enum value.
 */
function getStrategyName(strategy?: SelectorStrategy): string | undefined {
  if (strategy === undefined) return undefined;
  const names: Record<number, string> = {
    [SelectorStrategy.ID]: 'ID',
    [SelectorStrategy.NAME]: 'Name',
    [SelectorStrategy.ARIA_LABEL]: 'Aria-Label',
    [SelectorStrategy.LABEL_LINKED]: 'Label-Linked',
    [SelectorStrategy.PLACEHOLDER]: 'Placeholder',
    [SelectorStrategy.CSS_PATH]: 'CSS-Path',
    [SelectorStrategy.XPATH]: 'XPath',
    [SelectorStrategy.SHADOW_DOM]: 'Shadow-DOM',
  };
  return names[strategy] || 'Unknown';
}

export class RowResultAggregator {
  /**
   * Aggregate step-level logs and Excel rows into row-level results.
   * 
   * @param logs - All step-level LogEntry[] for the session
   * @param excelRows - All ExcelRow[] from IndexedDB (original upload)
   * @param steps - Optional recording steps for field name resolution
   * @returns RowResult[] in original Excel order
   */
  static aggregate(
    logs: LogEntry[],
    excelRows: ExcelRow[],
    steps?: Step[]
  ): RowResult[] {
    // Build a lookup map: rowIndex → LogEntry[]
    const logsByRow = new Map<number, LogEntry[]>();
    for (const log of logs) {
      const existing = logsByRow.get(log.rowIndex) || [];
      existing.push(log);
      logsByRow.set(log.rowIndex, existing);
    }

    // Build a steps lookup map: stepId → Step (for field name resolution)
    const stepsMap = new Map<string, Step>();
    if (steps) {
      for (const step of steps) {
        stepsMap.set(step.id, step);
      }
    }

    // Sort Excel rows by rowIndex to preserve original order (Recommendation #8)
    const sortedExcelRows = [...excelRows].sort((a, b) => a.rowIndex - b.rowIndex);

    const results: RowResult[] = [];

    for (let i = 0; i < sortedExcelRows.length; i++) {
      const excelRow = sortedExcelRows[i];
      const rowLogs = logsByRow.get(excelRow.rowIndex) || [];

      // Sort logs by timestamp for consistent ordering
      rowLogs.sort((a, b) => a.timestamp - b.timestamp);

      const rowResult = this.aggregateRow(
        i + 1,         // 1-based row number
        excelRow,
        rowLogs,
        stepsMap
      );

      results.push(rowResult);
    }

    return results;
  }

  /**
   * Aggregate a single row's logs into a RowResult.
   */
  private static aggregateRow(
    rowNumber: number,
    excelRow: ExcelRow,
    logs: LogEntry[],
    stepsMap: Map<string, Step>
  ): RowResult {
    // Handle missing logs — row was never executed (Recommendation #9)
    if (logs.length === 0) {
      return {
        rowNumber,
        rowIndex: excelRow.rowIndex,
        data: excelRow.data,
        timestamp: '',
        status: RowResultStatus.NOT_STARTED,
        retries: 0,
        durationMs: 0,
        warning: '',
        error: '',
        steps: [],
      };
    }

    // Compute aggregated values
    let maxStatusPriority = RowResultStatus.SUCCESS;
    let totalRetries = 0;
    let totalDuration = 0;
    const warnings: string[] = [];
    const errors: string[] = [];
    const stepDetails: StepDetail[] = [];

    for (const log of logs) {
      // Status priority: row status = max(step statuses) (Recommendation #3)
      const stepPriority = logStatusToPriority(log.status);
      if (stepPriority > maxStatusPriority) {
        maxStatusPriority = stepPriority;
      }

      // Retries: sum of actual retries, not attempt count (Recommendation #6)
      // log.retryCount is already 0-based (0 = no retries, 1 = one retry, etc.)
      totalRetries += log.retryCount ?? 0;

      // Duration: null-guard to prevent NaN (Recommendation #5)
      totalDuration += log.duration ?? 0;

      // Collect warnings
      if (isWarningStatus(log.status)) {
        const fieldName = getFieldName(log, stepsMap);
        const msg = log.error
          ? `${fieldName}: ${log.error}`
          : `${fieldName}: ${log.status}`;
        warnings.push(msg);
      }

      // Collect errors
      if (isErrorStatus(log.status) && log.error) {
        const fieldName = getFieldName(log, stepsMap);
        errors.push(`${fieldName}: ${log.error}`);
      }

      // Build step detail for JSON enrichment (Recommendation #12)
      stepDetails.push({
        field: getFieldName(log, stepsMap),
        action: Action[log.action] || String(log.action),
        value: log.value,
        strategy: getStrategyName(log.selectorStrategy),
        confidence: undefined, // Not available on LogEntry directly
        duration: log.duration ?? 0,
        status: log.status,
        error: log.error,
        retries: log.retryCount ?? 0,
      });
    }

    // Timestamp: earliest log entry (first action on this row)
    const earliestTimestamp = logs[0].timestamp;

    return {
      rowNumber,
      rowIndex: excelRow.rowIndex,
      data: excelRow.data,
      timestamp: new Date(earliestTimestamp).toISOString(),
      status: maxStatusPriority,
      retries: totalRetries,
      durationMs: totalDuration,
      warning: warnings.join('; '),
      error: errors.join('; '),
      steps: stepDetails,
    };
  }

  /**
   * Compute summary counters from aggregated results.
   */
  static computeSummary(results: RowResult[]): ExportSummary {
    const summary: ExportSummary = {
      totalRows: results.length,
      success: 0,
      failed: 0,
      warning: 0,
      skipped: 0,
      notStarted: 0,
      totalDurationMs: 0,
      totalRetries: 0,
    };

    for (const row of results) {
      switch (row.status) {
        case RowResultStatus.SUCCESS:
          summary.success++;
          break;
        case RowResultStatus.FAILED:
          summary.failed++;
          break;
        case RowResultStatus.WARNING:
          summary.warning++;
          break;
        case RowResultStatus.SKIPPED:
          summary.skipped++;
          break;
        case RowResultStatus.NOT_STARTED:
          summary.notStarted++;
          break;
      }
      summary.totalDurationMs += row.durationMs;
      summary.totalRetries += row.retries;
    }

    return summary;
  }
}
