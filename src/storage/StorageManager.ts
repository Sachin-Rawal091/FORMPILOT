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

  async getExcelData(offset?: number, limit?: number): Promise<ExcelRow[]> {
    if (isContentScript()) {
      const response = await sendToBackground({
        type: MessageType.GET_EXCEL_DATA,
        payload: { offset, limit },
        sessionId: "",
        timestamp: Date.now()
      });
      return response ? (response as any).excelRows || [] : [];
    }
    const db = await getDB();
    const tx = db.transaction('excelData', 'readonly');
    const store = tx.objectStore('excelData');
    
    if (offset !== undefined && limit !== undefined) {
      const rows: ExcelRow[] = [];
      let cursor = await store.openCursor();
      let skipped = 0;
      while (cursor && skipped < offset) {
        skipped++;
        cursor = await cursor.continue();
      }
      while (cursor && rows.length < limit) {
        rows.push(cursor.value);
        cursor = await cursor.continue();
      }
      return rows;
    }
    
    return store.getAll();
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
      tx.objectStore('excelData').put(row);
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

    if (overLimit <= 0) return; // Nothing to do

    const tx = db.transaction('logs', 'readwrite');
    const index = tx.store.index('timestamp');
    let cursor = await index.openCursor();
    
    let deletedCount = 0;
    while (cursor) {
      const log = cursor.value;
      const shouldDelete = log.timestamp < cutoffTime || deletedCount < overLimit;
      
      if (shouldDelete) {
        await cursor.delete();
        deletedCount++;
        cursor = await cursor.continue();
      } else {
        // Stop once we are past cutoff date and have deleted enough excess logs
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
    return db.get('files', alias);
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
