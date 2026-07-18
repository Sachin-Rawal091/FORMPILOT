import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'FormPilotDB';
const DB_VERSION = 7; // v7 adds the non-extractable CryptoKey store for encryption-at-rest

export async function getDB(): Promise<IDBPDatabase> {
  const db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('recordings')) {
          db.createObjectStore('recordings', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('excelData')) {
          db.createObjectStore('excelData', { keyPath: 'rowIndex' });
        }
        if (!db.objectStoreNames.contains('logs')) {
          const logsStore = db.createObjectStore('logs', { keyPath: 'id' });
          logsStore.createIndex('sessionId', 'sessionId');
          logsStore.createIndex('timestamp', 'timestamp');
          logsStore.createIndex('sessionTimestamp', ['sessionId', 'timestamp']);
        }
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'sessionId' });
        }
      }
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'alias' });
        }
      }
      if (oldVersion >= 1 && oldVersion < 3) {
        if (db.objectStoreNames.contains('logs')) {
          const logsStore = transaction.objectStore('logs');
          if (!logsStore.indexNames.contains('sessionId')) {
            logsStore.createIndex('sessionId', 'sessionId');
          }
          if (!logsStore.indexNames.contains('timestamp')) {
            logsStore.createIndex('timestamp', 'timestamp');
          }
        }
      }
      if (oldVersion < 5 && db.objectStoreNames.contains('logs')) {
        const logsStore = transaction.objectStore('logs');
        if (!logsStore.indexNames.contains('sessionTimestamp')) {
          logsStore.createIndex('sessionTimestamp', ['sessionId', 'timestamp']);
        }
      }
      if (oldVersion < 6) {
        if (db.objectStoreNames.contains('sessions')) {
          const sessionStore = transaction.objectStore('sessions');
          if (!sessionStore.indexNames.contains('timestamp')) {
            sessionStore.createIndex('timestamp', 'timestamp');
          }
        }
      }
      if (oldVersion < 7) {
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys'); // out-of-line keys — db.put('keys', cryptoKey, 'fpDataKey')
        }
      }
    },
  });

  db.addEventListener('versionchange', () => {
    db.close();
  });

  return db;
}
