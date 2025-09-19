import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { StoredRequest, SyncEventRecord } from './types.js';

export type OfflineHttpDatabase = IDBPDatabase;

export interface DatabaseOptions {
  databaseName?: string;
  storeName?: string;
  eventStoreName?: string;
}

const DEFAULT_DB_NAME = 'offline-http-client';
const DEFAULT_REQUEST_STORE = 'requests';
const DEFAULT_EVENT_STORE = 'events';

export async function initDatabase(options: DatabaseOptions = {}): Promise<OfflineHttpDatabase> {
  const databaseName = options.databaseName ?? DEFAULT_DB_NAME;
  const requestStoreName = options.storeName ?? DEFAULT_REQUEST_STORE;
  const eventStoreName = options.eventStoreName ?? DEFAULT_EVENT_STORE;

  return openDB(databaseName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(requestStoreName)) {
        const store = db.createObjectStore(requestStoreName, {
          keyPath: 'id',
        });
        store.createIndex('by-state', 'state');
        store.createIndex('by-updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(eventStoreName)) {
        const store = db.createObjectStore(eventStoreName, {
          keyPath: 'id',
        });
        store.createIndex('by-timestamp', 'timestamp');
      }
    },
  });
}

export async function saveRequest(db: OfflineHttpDatabase, storeName: string, request: StoredRequest): Promise<void> {
  await db.put(storeName, request);
}

export async function getRequest(db: OfflineHttpDatabase, storeName: string, id: string): Promise<StoredRequest | undefined> {
  return db.get(storeName, id);
}

export async function deleteRequest(db: OfflineHttpDatabase, storeName: string, id: string): Promise<void> {
  await db.delete(storeName, id);
}

export async function listRequests(db: OfflineHttpDatabase, storeName: string): Promise<StoredRequest[]> {
  return db.getAll(storeName);
}

export async function listRequestsByState(
  db: OfflineHttpDatabase,
  storeName: string,
  state: StoredRequest['state'],
): Promise<StoredRequest[]> {
  return db.getAllFromIndex(storeName, 'by-state', state);
}

export async function updateRequest(db: OfflineHttpDatabase, storeName: string, request: StoredRequest): Promise<void> {
  await db.put(storeName, request);
}

export async function saveEvent(db: OfflineHttpDatabase, eventStoreName: string, record: SyncEventRecord): Promise<void> {
  await db.put(eventStoreName, record);
}

export async function getEventLog(db: OfflineHttpDatabase, eventStoreName: string, since?: number): Promise<SyncEventRecord[]> {
  if (typeof since === 'number') {
    const tx = db.transaction(eventStoreName, 'readonly');
    const index = tx.store.index('by-timestamp');
    const range = IDBKeyRange.lowerBound(since, true);
    const events: SyncEventRecord[] = [];
    let cursor = await index.openCursor(range);
    while (cursor) {
      events.push(cursor.value);
      cursor = await cursor.continue();
    }
    await tx.done;
    return events;
  }
  return db.getAll(eventStoreName);
}

export async function pruneEvents(db: OfflineHttpDatabase, eventStoreName: string, retainMs: number): Promise<void> {
  const cutoff = Date.now() - retainMs;
  const tx = db.transaction(eventStoreName, 'readwrite');
  const index = tx.store.index('by-timestamp');
  let cursor = await index.openCursor();
  while (cursor) {
    if (cursor.value.timestamp < cutoff) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function clearDatabase(db: OfflineHttpDatabase, storeName: string): Promise<void> {
  await db.clear(storeName);
}

export async function migrateFailedToPending(
  db: OfflineHttpDatabase,
  storeName: string,
  ids: string[],
): Promise<void> {
  const tx = db.transaction(storeName, 'readwrite');
  for (const id of ids) {
    const value = await tx.store.get(id);
    if (!value) continue;
    value.state = 'pending';
    value.attempts = 0;
    value.updatedAt = Date.now();
    value.lastError = undefined;
    await tx.store.put(value);
  }
  await tx.done;
}
