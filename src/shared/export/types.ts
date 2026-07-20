/**
 * Export DTOs — Data Transfer Objects for the export system.
 * 
 * These types decouple internal LogEntry/ExcelRow models from export output,
 * following the DTO pattern (Recommendation #4).
 * 
 * Flow: LogEntry (internal) → RowResult (domain) → CSVRow/ExportEnvelope (export)
 */

// --- Status Priority Enum (Recommendation #3) ---

/** 
 * Status priority for row-level aggregation.
 * Row status = max(stepStatuses) — no nested if/else chains.
 */
export enum RowResultStatus {
  SUCCESS = 0,
  WARNING = 1,
  SKIPPED = 2,
  FAILED = 3,
  NOT_STARTED = 4,
}

/** Human-readable status labels for export output */
export const ROW_STATUS_LABELS: Record<RowResultStatus, string> = {
  [RowResultStatus.SUCCESS]: 'SUCCESS',
  [RowResultStatus.WARNING]: 'WARNING',
  [RowResultStatus.SKIPPED]: 'SKIPPED',
  [RowResultStatus.FAILED]: 'FAILED',
  [RowResultStatus.NOT_STARTED]: 'NOT_STARTED',
};

// --- Row Result (Domain Model) ---

/** 
 * Aggregated result for a single Excel data row.
 * Produced by RowResultAggregator, consumed by CSVExporter and JSONExporter.
 */
export interface RowResult {
  /** 1-based row number matching original Excel order */
  rowNumber: number;
  /** Original Excel row index (0-based, from ExcelRow.rowIndex) */
  rowIndex: number;
  /** Original form data from the Excel upload */
  data: Record<string, string | number | boolean | null>;
  /** ISO timestamp of the first log entry for this row */
  timestamp: string;
  /** Aggregated status (max priority across all steps) */
  status: RowResultStatus;
  /** Total actual retries across all steps (not attempt count) */
  retries: number;
  /** Total duration in ms across all steps (null-guarded) */
  durationMs: number;
  /** Concatenated warning messages (empty string if none) */
  warning: string;
  /** Concatenated error messages (empty string if none) */
  error: string;
  /** Per-step details for JSON enrichment (Recommendation #12) */
  steps: StepDetail[];
}

/** Per-step detail for enriched JSON export */
export interface StepDetail {
  /** Human-readable field label */
  field: string;
  /** Action performed */
  action: string;
  /** Value filled (if applicable) */
  value?: string;
  /** Selector strategy that matched */
  strategy?: string;
  /** Selector confidence score (0-1) */
  confidence?: number;
  /** Step duration in ms */
  duration: number;
  /** Step result status */
  status: string;
  /** Error message if step failed */
  error?: string;
  /** Number of retries for this step */
  retries: number;
}

// --- Export Envelope (JSON output wrapper, Recommendation #18) ---

/** Self-documenting JSON export envelope */
export interface ExportEnvelope {
  /** ISO timestamp when the export was generated */
  exportedAt: string;
  /** Export format version for future compatibility */
  exportVersion: string;
  /** Name of the workflow/recording */
  workflowName: string;
  /** Session ID of the execution run */
  sessionId: string;
  /** Aggregate summary counters */
  summary: ExportSummary;
  /** Per-row results */
  rows: RowResult[];
}

/** Summary counters for the export envelope */
export interface ExportSummary {
  totalRows: number;
  success: number;
  failed: number;
  warning: number;
  skipped: number;
  notStarted: number;
  totalDurationMs: number;
  totalRetries: number;
}

// --- CSV Row (flat export model, Recommendation #4) ---

/** 
 * Flat representation of a row for CSV export.
 * Column order: Row # | [form data columns] | Timestamp | Status | Retries | Duration (ms) | Warning | Error
 */
export interface CSVRow {
  rowNumber: number;
  formData: Record<string, string>;
  timestamp: string;
  status: string;
  retries: number;
  durationMs: number;
  warning: string;
  error: string;
}

/** Configuration for CSV export generation */
export interface CSVExportConfig {
  /** Maximum error message length in CSV (default: 1000) */
  maxErrorLength: number;
  /** Maximum warning message length in CSV (default: 500) */
  maxWarningLength: number;
  /** Whether to include UTF-8 BOM (default: true) */
  includeBOM: boolean;
}

/** Default CSV export configuration */
export const DEFAULT_CSV_CONFIG: CSVExportConfig = {
  maxErrorLength: 1000,
  maxWarningLength: 500,
  includeBOM: true,
};
