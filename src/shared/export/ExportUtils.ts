/**
 * ExportUtils — Shared utility functions for the export system.
 * 
 * Provides CSV escaping, file download, filename sanitization,
 * and UTF-8 BOM handling.
 */

/** UTF-8 Byte Order Mark — ensures Excel on Windows opens CSV files correctly (Recommendation #16) */
export const UTF8_BOM = '\uFEFF';

/**
 * Escape a value for safe CSV embedding (Recommendation #10).
 * 
 * Handles:
 * - Double quotes → doubled ("" escaping per RFC 4180)
 * - Embedded commas, newlines, tabs → quoted
 * - Leading =, +, -, @ → prefixed with single quote to prevent CSV injection / Excel formula execution
 * - null/undefined → empty string
 */
export function escapeCSV(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';

  const str = String(value);
  if (str === '') return '';

  // CSV injection prevention: prefix formula-triggering characters with a single quote
  const needsFormulaGuard = /^[=+\-@]/.test(str);
  const sanitized = needsFormulaGuard ? `'${str}` : str;

  // RFC 4180: if the field contains quotes, commas, or newlines, wrap in quotes
  const needsQuoting = /[",\n\r\t]/.test(sanitized) || needsFormulaGuard;

  if (needsQuoting) {
    // Double any existing quotes
    return `"${sanitized.replace(/"/g, '""')}"`;
  }

  return sanitized;
}

/**
 * Truncate a string to a maximum length, appending "..." if truncated (Recommendation #11).
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text || '';
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Sanitize a string for use as a filename (Recommendation #17).
 * Removes characters that are invalid in Windows/macOS/Linux filenames.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')  // Invalid filename chars
    .replace(/\s+/g, '_')                       // Spaces → underscores
    .replace(/_+/g, '_')                         // Collapse multiple underscores
    .replace(/^_|_$/g, '')                       // Trim leading/trailing underscores
    .slice(0, 100);                              // Cap filename length
}

/**
 * Generate a timestamped export filename.
 * 
 * @param prefix - e.g., "formpilot_results"
 * @param workflowName - e.g., "KRP Registration Portal"
 * @param extension - e.g., "csv" or "json"
 * @returns Sanitized filename like "formpilot_results_KRP_Registration_Portal_2026-07-20.csv"
 */
export function generateExportFilename(prefix: string, workflowName: string, extension: string): string {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const safeName = sanitizeFilename(workflowName);
  return `${prefix}_${safeName}_${date}.${extension}`;
}

/**
 * Download a string as a file using chrome.downloads API or fallback anchor click.
 * 
 * @param content - File content string
 * @param filename - Target filename
 * @param mimeType - MIME type (e.g., "text/csv", "application/json")
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);

  // Prefer Chrome extension downloads API for instant downloads (bypasses security scan delays)
  if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
    chrome.downloads.download({
      url,
      filename,
      saveAs: true
    }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
    return;
  }

  // Fallback for non-extension contexts
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * Used in export summary sections.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}
