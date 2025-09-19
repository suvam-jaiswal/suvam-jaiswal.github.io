import { openDB, type IDBPDatabase } from 'idb';
import {
  type OfflineDbSchema,
  type OfflineRequestStatus,
  type QueueMetrics,
  type SerializedError,
  type StoredRequest,
} from '../types.js';

const DEFAULT_DB_NAME = 'offline-http-helpers';
const DEFAULT_STORE_NAME = 'requests';
const DB_VERSION = 1;

const priorityRank: Record<StoredRequest['priority'], number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export interface OfflineQueueOptions {
  dbName?: string;
}

export interface QueueInsertPayload
  extends Omit<
    StoredRequest,
    'priorityIndex' | 'createdAt' | 'updatedAt' | 'status' | 'retries' | 'lastError' | 'priority'
  > {
  priority?: StoredRequest['priority'];
  createdAt?: number;
  updatedAt?: number;
  status?: OfflineRequestStatus;
  retries?: number;
  lastError?: SerializedError;
}

export class OfflineRequestQueue {
  private dbPromise?: Promise<IDBPDatabase<OfflineDbSchema>>;

  constructor(private readonly options: OfflineQueueOptions = {}) {}

  private get dbName(): string {
    return this.options.dbName ?? DEFAULT_DB_NAME;
  }

  async init(): Promise<void> {
    await this.getDb();
  }

  async enqueue(payload: QueueInsertPayload): Promise<StoredRequest> {
    const now = Date.now();
    const record: StoredRequest = {
      ...payload,
      priorityIndex: priorityRank[payload.priority ?? 'normal'],
      priority: payload.priority ?? 'normal',
      createdAt: payload.createdAt ?? now,
      updatedAt: now,
      status: payload.status ?? 'pending',
      retries: payload.retries ?? 0,
      lastError: payload.lastError,
    } as StoredRequest;

    const db = await this.getDb();
    const tx = db.transaction(DEFAULT_STORE_NAME, 'readwrite');
    await tx.store.put(record);
    await tx.done;
    return record;
  }

  async update(id: string, patch: Partial<StoredRequest>): Promise<StoredRequest | undefined> {
    const db = await this.getDb();
    const tx = db.transaction(DEFAULT_STORE_NAME, 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) {
      await tx.done;
      return undefined;
    }

    const updated: StoredRequest = {
      ...existing,
      ...patch,
      priorityIndex: patch.priority ? priorityRank[patch.priority] : existing.priorityIndex,
      updatedAt: Date.now(),
    };

    await tx.store.put(updated);
    await tx.done;
    return updated;
  }

  async get(id: string): Promise<StoredRequest | undefined> {
    const db = await this.getDb();
    return db.get(DEFAULT_STORE_NAME, id);
  }

  async delete(id: string): Promise<void> {
    const db = await this.getDb();
    await db.delete(DEFAULT_STORE_NAME, id);
  }

  async list(status: OfflineRequestStatus = 'pending'): Promise<StoredRequest[]> {
    const db = await this.getDb();
    const index = db.transaction(DEFAULT_STORE_NAME).store.index('by_status_priority');

    const requests: StoredRequest[] = [];
    let cursor = await index.openCursor(IDBKeyRange.bound([status, 0], [status, Infinity]));

    while (cursor) {
      requests.push(cursor.value);
      cursor = await cursor.continue();
    }

    return requests;
  }

  async all(): Promise<StoredRequest[]> {
    const db = await this.getDb();
    return db.getAll(DEFAULT_STORE_NAME);
  }

  async metrics(): Promise<QueueMetrics> {
    const db = await this.getDb();
    const store = db.transaction(DEFAULT_STORE_NAME).store;
    const all = await store.getAll();
    const pending = all.filter((item) => item.status === 'pending').length;
    const failed = all.filter((item) => item.status === 'failed').length;

    return {
      pending,
      failed,
    };
  }

  private async getDb(): Promise<IDBPDatabase<OfflineDbSchema>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<OfflineDbSchema>(this.dbName, DB_VERSION, {
        upgrade: (db) => {
          if (!db.objectStoreNames.contains(DEFAULT_STORE_NAME)) {
            const store = db.createObjectStore(DEFAULT_STORE_NAME, {
              keyPath: 'id',
            });
            store.createIndex('by_status_priority', ['status', 'priorityIndex']);
          }
        },
      });
    }

    return this.dbPromise;
  }
}

export const mapPriorityToIndex = (priority: StoredRequest['priority']): number =>
  priorityRank[priority];

export const mapIndexToPriority = (index: number): StoredRequest['priority'] => {
  if (index <= 0) return 'high';
  if (index === 1) return 'normal';
  return 'low';
};
