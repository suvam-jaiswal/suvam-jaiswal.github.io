import type {
  HttpMethod,
  OfflineQueueOptions,
  QueuedRequestPayload,
  ResponseType,
  SerializedError,
  SerializedRequestInit,
} from './types.js';
import { generateRequestId, hasIndexedDbSupport, now } from './utils.js';

const STORE_NAME = 'requests';

export interface EnqueueOptions {
  url: string;
  method: HttpMethod;
  requestInit: SerializedRequestInit;
  responseType: ResponseType;
  metadata?: Record<string, unknown>;
  id?: string;
  createdAt?: number;
  attempts?: number;
  nextAttemptAt?: number | null;
  lastError?: SerializedError | null;
}

export class OfflineQueue {
  private readonly dbName: string;
  private readonly dbVersion: number;
  private readonly dbPromise: Promise<IDBDatabase>;

  constructor(options: OfflineQueueOptions = {}) {
    if (!hasIndexedDbSupport()) {
      throw new Error('IndexedDB is required for OfflineQueue but not available in this environment.');
    }
    this.dbName = options.dbName ?? 'offline-http-helper';
    this.dbVersion = options.dbVersion ?? 1;
    this.dbPromise = this.openDatabase();
  }

  async enqueue(options: EnqueueOptions): Promise<QueuedRequestPayload> {
    const record: QueuedRequestPayload = {
      id: options.id ?? generateRequestId(),
      url: options.url,
      method: options.method,
      requestInit: options.requestInit,
      ...(options.metadata ? { metadata: options.metadata } : {}),
      responseType: options.responseType,
      createdAt: options.createdAt ?? now(),
      attempts: options.attempts ?? 0,
      lastAttemptAt: undefined,
      lastError: options.lastError ?? null,
      nextAttemptAt: options.nextAttemptAt ?? null,
    };
    await this.put(record);
    return record;
  }

  async getAll(): Promise<QueuedRequestPayload[]> {
    const db = await this.dbPromise;
    return new Promise<QueuedRequestPayload[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result as QueuedRequestPayload[]) ?? []);
      request.onerror = () => reject(request.error ?? new Error('Failed to read queued requests'));
    });
  }

  async get(id: string): Promise<QueuedRequestPayload | undefined> {
    const db = await this.dbPromise;
    return new Promise<QueuedRequestPayload | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve((request.result as QueuedRequestPayload) ?? undefined);
      request.onerror = () => reject(request.error ?? new Error(`Failed to read queued request ${id}`));
    });
  }

  async update(id: string, update: Partial<QueuedRequestPayload>): Promise<QueuedRequestPayload | undefined> {
    const current = await this.get(id);
    if (!current) {
      return undefined;
    }
    const updated: QueuedRequestPayload = {
      ...current,
      ...update,
    };
    await this.put(updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`Failed to delete request ${id}`));
      tx.onabort = () => reject(tx.error ?? new Error(`Request deletion aborted for ${id}`));
    });
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to clear queue'));
      tx.onabort = () => reject(tx.error ?? new Error('Queue clear aborted'));
    });
  }

  async close(): Promise<void> {
    const db = await this.dbPromise;
    db.close();
  }

  private async put(record: QueuedRequestPayload): Promise<void> {
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to persist request'));
      tx.onabort = () => reject(tx.error ?? new Error('Request persistence aborted'));
    });
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('Failed to open IndexedDB database'));
      };
      request.onblocked = () => {
        reject(new Error('IndexedDB upgrade blocked by another connection'));
      };
    });
  }
}

