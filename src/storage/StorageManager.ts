import { getDB } from './db';
import { LOG_MAX_ENTRIES, LOG_RETENTION_DAYS } from '../shared/constants';
import { 
  ExecutionState, 
  Recording, 
  UserSettings, 
  ExcelRow, 
  LogEntry, 
  SessionMeta,
  FileBlob,
  RecordingState,
  MessageType
} from '../types';
import { sendToBackground } from '../shared/messages';
import { sanitizeLogText } from '../utils/sanitize';
import { logger } from '../utils/logger';
import { encryptValue, decryptValue, encryptBuffer, decryptBuffer } from '../utils/crypto';

export function isContentScript(): boolean {
  return typeof window !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime && !chrome.tabs;
}

class StorageManagerImpl {
  
  // --- Session Storage (Volatile, per-session) ---
  async getExecutionState(): Promise<ExecutionState | null> {
    if (isContentScript()) {
      const response = await sendToBackground({
        type: MessageType.GET_EXECUTION_STATE,
        payload: {},
        sessionId: "",
        timestamp: Date.now()
      });
      return response ? (response as any).state : null;
    }
    const data = await chrome.storage.session.get('executionState');
    return (data.executionState as ExecutionState) || null;
  }

  async setExecutionState(state: ExecutionState): Promise<void> {
    if (isContentScript()) {
      await sendToBackground({
        type: MessageType.SET_EXECUTION_STATE,
        payload: { state },
        sessionId: "",
        timestamp: Date.now()
      });
      return;
    }
    if (state === null) {
      await chrome.storage.session.remove('executionState');
    } else {
      await chrome.storage.session.set({ executionState: state });
    }
  }

  async clearExecutionState(): Promise<void> {
    if (isContentScript()) {
      await sendToBackground({
        type: MessageType.SET_EXECUTION_STATE,
        payload: { state: null },
        sessionId: "",
        timestamp: Date.now()
      });
      return;
    }
    await chrome.storage.session.remove('executionState');
  }

  async getRecordingState(): Promise<RecordingState | null> {
    if (isContentScript()) {
      const response = await sendToBackground({
        type: MessageType.GET_STATUS,
        payload: {},
        sessionId: "",
        timestamp: Date.now()
      });
      return response ? (response as any).recordingState : null;
    }
    const data = await chrome.storage.session.get('recordingState');
    return (data.recordingState as RecordingState) || null;
  }

  async setRecordingState(state: RecordingState): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const isActive = !!(state && state.isRecording);
      await chrome.storage.local.set({ isRecordingActive: isActive });
    }
    await chrome.storage.session.set({ recordingState: state });
  }

  async clearRecordingState(): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ isRecordingActive: false });
    }
    await chrome.storage.session.remove('recordingState');
  }


  // --- Local Storage (Persistent, 10MB cap) ---
  async getUserSettings(): Promise<UserSettings | null> {
    const data = await chrome.storage.local.get('settings');
    return data.settings || null;
  }

  async setUserSettings(settings: UserSettings): Promise<void> {
    await chrome.storage.local.set({ settings });
  }
  
  // --- IndexedDB (Persistent, unlimited) ---
  
  async getRecordings(): Promise<Recording[]> {
    const db = await getDB();
    return db.getAll('recordings');
  }

  async setRecordings(recordings: Recording[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('recordings', 'readwrite');
    await tx.objectStore('recordings').clear();
    for (const recording of recordings) {
      tx.objectStore('recordings').put(recording);
    }
    await tx.done;
  }

  async getExcelData(afterRowIndex?: number, limit?: number): Promise<ExcelRow[]> {
    if (isContentScript()) {
      const response = await sendToBackground({
        type: MessageType.GET_EXCEL_DATA,
        payload: { afterRowIndex, limit },
        sessionId: "",
        timestamp: Date.now()
      });
      return response ? (response as any).excelRows || [] : [];
    }
    const db = await getDB();
    const tx = db.transaction('excelData', 'readonly');
    const store = tx.objectStore('excelData');
    
    let encryptedRows: any[] = [];
    if (limit !== undefined) {
      const range = afterRowIndex !== undefined ? IDBKeyRange.lowerBound(afterRowIndex, true) : null;
      let cursor = await store.openCursor(range);
      
      while (cursor && encryptedRows.length < limit) {
        encryptedRows.push(cursor.value);
        cursor = await cursor.continue();
      }
    } else {
      encryptedRows = await store.getAll();
    }

    const decryptedRows: ExcelRow[] = [];
    for (const row of encryptedRows) {
      if (row.encryptedBlob) {
        try {
          const decrypted = await decryptValue(row.encryptedBlob);
          decryptedRows.push({
            rowIndex: row.rowIndex,
            data: decrypted.data,
            status: decrypted.status,
            isValid: decrypted.isValid,
            validationErrors: decrypted.validationErrors,
            error: decrypted.error
          });
        } catch (err) {
          logger.error('StorageManager', `Failed to decrypt excel row ${row.rowIndex}:`, err);
          throw err;
        }
      } else {
        // Fallback for unencrypted legacy rows
        decryptedRows.push(row);
      }
    }
    return decryptedRows;
  }

  async getExcelDataCount(): Promise<number> {
    const db = await getDB();
    const tx = db.transaction('excelData', 'readonly');
    const store = tx.objectStore('excelData');
    return store.count();
  }

  async setExcelData(rows: ExcelRow[], clearFirst = true): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('excelData', 'readwrite');
    if (clearFirst) {
      await tx.objectStore('excelData').clear();
    }
    for (const row of rows) {
      const encryptedBlob = await encryptValue({
        data: row.data,
        status: row.status,
        isValid: row.isValid,
        validationErrors: row.validationErrors,
        error: row.error
      });
      await tx.objectStore('excelData').put({
        rowIndex: row.rowIndex,
        encryptedBlob
      });
    }
    await tx.done;
  }

  async addLogEntry(entry: LogEntry): Promise<void> {
    const db = await getDB();
    const sanitizedEntry: LogEntry = {
      ...entry,
      value: sanitizeLogText(entry.value),
      error: sanitizeLogText(entry.error)
    };
    await db.put('logs', sanitizedEntry);
    // Deterministic cleanup: run only when log count exceeds maxEntries with 5% buffer
    const count = await db.count('logs');
    const settings = await this.getUserSettings();
    const maxEntries = settings?.logMaxEntries ?? LOG_MAX_ENTRIES;
    if (count > maxEntries * 1.05) {
      this.cleanupLogs().catch(err => logger.error('StorageManager', 'Log cleanup failed:', err));
    }
  }

  async cleanupLogs(): Promise<void> {
    if (isContentScript()) {
      return; // Cleanup is managed by the background script side
    }
    const db = await getDB();
    
    // Read limits from settings OUTSIDE of the transaction
    const settings = await this.getUserSettings();
    const maxEntries = settings?.logMaxEntries ?? LOG_MAX_ENTRIES;
    const retentionDays = settings?.logRetentionDays ?? LOG_RETENTION_DAYS;
    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

    const totalCount = await db.count('logs');
    const overLimit = totalCount - maxEntries;

    const tx = db.transaction('logs', 'readwrite');
    const index = tx.store.index('timestamp');
    let cursor = await index.openCursor();
    
    let deletedCount = 0;
    while (cursor) {
      const log = cursor.value;
      const shouldDelete = (overLimit > 0 && deletedCount < overLimit) || log.timestamp < cutoffTime;
      
      if (shouldDelete) {
        await cursor.delete();
        deletedCount++;
        cursor = await cursor.continue();
      } else {
        // Since the index is sorted by timestamp ascending, once we are:
        // 1. Below the maximum entry limit (deletedCount >= overLimit) AND
        // 2. The current log's timestamp is >= cutoffTime
        // We can safely stop since all subsequent logs are also >= cutoffTime
        break;
      }
    }
    await tx.done;
  }

  async getLogs(sessionId: string, offset = 0, limit = 500): Promise<LogEntry[]> {
    const db = await getDB();
    const tx = db.transaction('logs', 'readonly');
    const index = tx.store.index('sessionTimestamp');
    const rows: LogEntry[] = [];
    const range = IDBKeyRange.bound([sessionId, 0], [sessionId, 2e15]);
    let skipped = 0;
    let cursor = await index.openCursor(range, 'prev');

    while (cursor && rows.length < limit) {
      if (skipped < offset) {
        skipped++;
      } else {
        rows.push(cursor.value);
      }
      cursor = await cursor.continue();
    }

    return rows;
  }

  async hasSessionFailures(sessionId: string): Promise<boolean> {
    const db = await getDB();
    const tx = db.transaction('logs', 'readonly');
    const index = tx.store.index('sessionId');
    let cursor = await index.openCursor(IDBKeyRange.only(sessionId));

    while (cursor) {
      const status = cursor.value.status;
      if (status === 'FAILED' || status === 'ROW_SKIPPED' || status === 'CAPTCHA_DETECTED') {
        return true;
      }
      cursor = await cursor.continue();
    }

    return false;
  }

  async addSessionMeta(meta: SessionMeta): Promise<void> {
    if (isContentScript()) {
      await sendToBackground({
        type: MessageType.ADD_SESSION_META,
        payload: { meta },
        sessionId: meta.sessionId,
        timestamp: Date.now()
      });
      return;
    }
    const db = await getDB();
    await db.put('sessions', meta);
    this.cleanupSessions().catch(err => logger.error('StorageManager', 'Session cleanup failed:', err));
  }

  async cleanupSessions(): Promise<void> {
    if (isContentScript()) {
      return;
    }
    const settings = await this.getUserSettings();
    const retentionDays = settings?.logRetentionDays ?? LOG_RETENTION_DAYS;
    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    const db = await getDB();
    const tx = db.transaction('sessions', 'readwrite');
    const index = tx.store.index('timestamp');
    let cursor = await index.openCursor();
    while (cursor) {
      if (cursor.value.timestamp < cutoffTime) {
        await cursor.delete();
        cursor = await cursor.continue();
      } else {
        break;
      }
    }
    await tx.done;
  }

  async getSessionMetas(): Promise<SessionMeta[]> {
    if (isContentScript()) {
      const response = await sendToBackground({
        type: MessageType.GET_SESSION_METAS,
        payload: {},
        sessionId: "",
        timestamp: Date.now()
      });
      return response ? (response as any).sessions || [] : [];
    }
    const db = await getDB();
    return db.getAll('sessions');
  }

  async getFileBlob(alias: string): Promise<FileBlob | undefined> {
    if (isContentScript()) {
      const response = await sendToBackground({
        type: MessageType.GET_FILE_BLOB,
        payload: { alias },
        sessionId: "",
        timestamp: Date.now()
      });
      return response ? (response as any).fileBlob : undefined;
    }
    const db = await getDB();
    const encryptedRecord = await db.get('files', alias);
    if (!encryptedRecord) return undefined;

    try {
      const decryptedMeta = await decryptValue(encryptedRecord.encryptedMeta);
      const decryptedBuffer = await decryptBuffer(encryptedRecord.encryptedData);
      const blob = new Blob([decryptedBuffer], { type: decryptedMeta.type });
      return {
        alias: encryptedRecord.alias,
        data: blob,
        name: decryptedMeta.name,
        type: decryptedMeta.type
      };
    } catch (err) {
      logger.error('StorageManager', `Failed to decrypt file blob for alias ${alias}:`, err);
      throw err;
    }
  }

  async addFileBlob(fileBlob: FileBlob): Promise<void> {
    if (isContentScript()) {
      return;
    }
    const db = await getDB();
    
    // Encrypt the blob data and metadata
    const arrayBuffer = await fileBlob.data.arrayBuffer();
    const encryptedData = await encryptBuffer(arrayBuffer);
    const encryptedMeta = await encryptValue({
      name: fileBlob.name,
      type: fileBlob.type
    });

    await db.put('files', {
      alias: fileBlob.alias,
      encryptedData,
      encryptedMeta
    });
  }

  async getHistoricLogs(offset = 0, limit = 500): Promise<LogEntry[]> {
    const db = await getDB();
    const tx = db.transaction('logs', 'readonly');
    const index = tx.store.index('timestamp');
    const rows: LogEntry[] = [];
    let skipped = 0;
    let cursor = await index.openCursor(null, 'prev');

    while (cursor && rows.length < limit) {
      if (skipped < offset) {
        skipped++;
      } else {
        rows.push(cursor.value);
      }
      cursor = await cursor.continue();
    }

    return rows;
  }
}

export const StorageManager = new StorageManagerImpl();
