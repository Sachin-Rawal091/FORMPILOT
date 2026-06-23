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
  RecordingState
} from '../types';

class StorageManagerImpl {
  
  // --- Session Storage (Volatile, per-session) ---
  async getExecutionState(): Promise<ExecutionState | null> {
    const data = await chrome.storage.session.get('executionState');
    return (data.executionState as ExecutionState) || null;
  }

  async setExecutionState(state: ExecutionState): Promise<void> {
    await chrome.storage.session.set({ executionState: state });
  }

  async clearExecutionState(): Promise<void> {
    await chrome.storage.session.remove('executionState');
  }

  async getRecordingState(): Promise<RecordingState | null> {
    const data = await chrome.storage.session.get('recordingState');
    return (data.recordingState as RecordingState) || null;
  }

  async setRecordingState(state: RecordingState): Promise<void> {
    await chrome.storage.session.set({ recordingState: state });
  }

  async clearRecordingState(): Promise<void> {
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
    await db.put('logs', entry);
    // Periodically trigger cleanup (1% chance)
    if (Math.random() < 0.01) {
      this.cleanupLogs().catch(console.error);
    }
  }

  async cleanupLogs(): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('logs', 'readwrite');
    const store = tx.objectStore('logs');
    
    // Cleanup by date
    const cutoffTime = Date.now() - (LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const allKeys = await store.getAllKeys();
    
    // To do an efficient date cleanup without an index on timestamp, 
    // we fetch all records to check their timestamps if they exceed max entries
    if (allKeys.length > LOG_MAX_ENTRIES) {
      const allLogs = await store.getAll();
      allLogs.sort((a, b) => b.timestamp - a.timestamp); // Newest first
      
      const toDelete = allLogs.slice(LOG_MAX_ENTRIES);
      await Promise.all(toDelete.map(log => store.delete(log.id)));
      
      const remaining = allLogs.slice(0, LOG_MAX_ENTRIES);
      const remainingToDelete = remaining.filter(log => log.timestamp < cutoffTime);
      await Promise.all(remainingToDelete.map(log => store.delete(log.id)));
    } else {
      const allLogs = await store.getAll();
      const toDelete = allLogs.filter(log => log.timestamp < cutoffTime);
      await Promise.all(toDelete.map(log => store.delete(log.id)));
    }
    
    await tx.done;
  }

  async getLogs(sessionId: string): Promise<LogEntry[]> {
    const db = await getDB();
    return db.getAllFromIndex('logs', 'sessionId', sessionId);
  }

  async addSessionMeta(meta: SessionMeta): Promise<void> {
    const db = await getDB();
    await db.put('sessions', meta);
  }

  async getFileBlob(alias: string): Promise<FileBlob | undefined> {
    const db = await getDB();
    return db.get('files', alias);
  }

  async getHistoricLogs(): Promise<LogEntry[]> {
    const db = await getDB();
    return db.getAll('logs');
  }
}

export const StorageManager = new StorageManagerImpl();