import * as XLSX from 'xlsx';
import { ExcelRow, RowStatus } from '../types';
import { EXCEL_FUZZY_MAX_DISTANCE, EXCEL_EMPTY_ROW_THRESHOLD } from '../shared/constants';

export class ExcelDataEngine {
  /**
   * Parses an ArrayBuffer (from a File object) into an array of typed ExcelRows.
   * Handles empty row filtering and basic normalization.
   */
  static async parseExcelFile(buffer: ArrayBuffer): Promise<ExcelRow[]> {
    // Parse workbook
    const workbook = XLSX.read(buffer, { type: 'array' });
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error("Excel file contains no sheets.");
    }

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Convert to JSON
    // defval: null ensures empty cells are returned as null rather than missing keys
    const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: null });
    
    const excelRows: ExcelRow[] = [];
    
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i] as Record<string, any>;
      
      // Calculate empty threshold to skip completely blank rows
      const keys = Object.keys(row);
      const emptyCount = keys.filter(k => row[k] === null || row[k] === "").length;
      const emptyRatio = keys.length > 0 ? emptyCount / keys.length : 1;
      
      if (emptyRatio >= EXCEL_EMPTY_ROW_THRESHOLD) {
        continue; 
      }
      
      excelRows.push({
        // rowIndex typically skips the header row, so i+2 aligns with Excel UI row numbers
        rowIndex: i + 2,
        data: row,
        status: RowStatus.PENDING,
        isValid: true,
        validationErrors: []
      });
    }
    
    return excelRows;
  }
  
  /**
   * Matches a target column name against available columns.
   * Performs an exact match (case-insensitive) first, then falls back to Levenshtein fuzzy matching.
   */
  static fuzzyMatchColumn(target: string, availableColumns: string[]): string | null {
    if (!target || !availableColumns || availableColumns.length === 0) {
      return null;
    }

    const lowerTarget = target.trim().toLowerCase();
    
    // 1. Exact case-insensitive match
    for (const col of availableColumns) {
      if (col.trim().toLowerCase() === lowerTarget) {
        return col;
      }
    }
    
    // 2. Fuzzy match via Levenshtein distance
    let bestMatch: string | null = null;
    let minDistance = Infinity;
    
    for (const col of availableColumns) {
      const dist = this.levenshtein(lowerTarget, col.trim().toLowerCase());
      if (dist <= EXCEL_FUZZY_MAX_DISTANCE && dist < minDistance) {
        minDistance = dist;
        bestMatch = col;
      }
    }
    
    return bestMatch;
  }

  /**
   * Computes the Levenshtein distance between two strings.
   */
  private static levenshtein(a: string, b: string): number {
    const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    
    for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,        // deletion
          matrix[i][j - 1] + 1,        // insertion
          matrix[i - 1][j - 1] + cost  // substitution
        );
      }
    }
    return matrix[a.length][b.length];
  }
}
