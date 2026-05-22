import { getDB } from './db';
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
    if (offset !== undefined && limit !== undefined) {
      const tx = db.transaction('excelData', 'readonly');
      const store = tx.objectStore('excelData');
      const allRows = await store.getAll();
      return allRows.slice(offset, offset + limit);
    }
    return db.getAll('excelData');
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
  }

  async getLogs(sessionId: string): Promise<LogEntry[]> {
    const db = await getDB();
    const allLogs = await db.getAll('logs');
    return allLogs.filter((log: any) => log.sessionId === sessionId);
  }

  async addSessionMeta(meta: SessionMeta): Promise<void> {
    const db = await getDB();
    await db.put('sessions', meta);
  }

  async getFileBlob(alias: string): Promise<FileBlob | undefined> {
    const db = await getDB();
    return db.get('files', alias);
  }

  async setFileBlob(file: FileBlob): Promise<void> {
    const db = await getDB();
    await db.put('files', file);
  }
}

export const StorageManager = new StorageManagerImpl();