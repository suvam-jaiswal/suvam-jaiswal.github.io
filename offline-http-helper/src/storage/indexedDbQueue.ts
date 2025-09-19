import { openDB, type IDBPDatabase } from 'idb';
import type { StoredRequest } from '../types.js';

const DB_NAME = 'offline-http-helper';
const QUEUE_STORE = 'queue';
const FAILURE_STORE = 'dead-letter';

export interface DeadLetterEntry {
  id: string;
  request: StoredRequest;
  failedAt: number;
}

export class IndexedDbQueue {
  private dbPromise: Promise<IDBPDatabase>;

  constructor(private dbName: string = DB_NAME) {
    this.dbPromise = openDB(dbName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(FAILURE_STORE)) {
          db.createObjectStore(FAILURE_STORE, { keyPath: 'id' });
        }
      },
    });
  }

  async enqueue(request: StoredRequest): Promise<void> {
    const db = await this.dbPromise;
    await db.put(QUEUE_STORE, request);
  }

  async update(request: StoredRequest): Promise<void> {
    const db = await this.dbPromise;
    await db.put(QUEUE_STORE, request);
  }

  async next(): Promise<StoredRequest | undefined> {
    const db = await this.dbPromise;
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.store;
    const cursor = await store.openCursor();
    const result = cursor?.value as StoredRequest | undefined;
    await cursor?.delete();
    await tx.done;
    return result;
  }

  async getAll(): Promise<StoredRequest[]> {
    const db = await this.dbPromise;
    return (await db.getAll(QUEUE_STORE)) as StoredRequest[];
  }

  async remove(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete(QUEUE_STORE, id);
  }

  async addToDeadLetter(request: StoredRequest): Promise<void> {
    const db = await this.dbPromise;
    await db.put(FAILURE_STORE, {
      id: request.id,
      request,
      failedAt: Date.now(),
    } satisfies DeadLetterEntry);
    await db.delete(QUEUE_STORE, request.id);
  }

  async listDeadLetter(): Promise<DeadLetterEntry[]> {
    const db = await this.dbPromise;
    return (await db.getAll(FAILURE_STORE)) as DeadLetterEntry[];
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction([QUEUE_STORE, FAILURE_STORE], 'readwrite');
    await Promise.all([tx.objectStore(QUEUE_STORE).clear(), tx.objectStore(FAILURE_STORE).clear()]);
    await tx.done;
  }
}
