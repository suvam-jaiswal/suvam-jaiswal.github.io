import { generateRequestId, hasIndexedDbSupport, now } from './utils.js';
const STORE_NAME = 'requests';
export class OfflineQueue {
    constructor(options = {}) {
        if (!hasIndexedDbSupport()) {
            throw new Error('IndexedDB is required for OfflineQueue but not available in this environment.');
        }
        this.dbName = options.dbName ?? 'offline-http-helper';
        this.dbVersion = options.dbVersion ?? 1;
        this.dbPromise = this.openDatabase();
    }
    async enqueue(options) {
        const record = {
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
    async getAll() {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result ?? []);
            request.onerror = () => reject(request.error ?? new Error('Failed to read queued requests'));
        });
    }
    async get(id) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result ?? undefined);
            request.onerror = () => reject(request.error ?? new Error(`Failed to read queued request ${id}`));
        });
    }
    async update(id, update) {
        const current = await this.get(id);
        if (!current) {
            return undefined;
        }
        const updated = {
            ...current,
            ...update,
        };
        await this.put(updated);
        return updated;
    }
    async remove(id) {
        const db = await this.dbPromise;
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error(`Failed to delete request ${id}`));
            tx.onabort = () => reject(tx.error ?? new Error(`Request deletion aborted for ${id}`));
        });
    }
    async clear() {
        const db = await this.dbPromise;
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('Failed to clear queue'));
            tx.onabort = () => reject(tx.error ?? new Error('Queue clear aborted'));
        });
    }
    async close() {
        const db = await this.dbPromise;
        db.close();
    }
    async put(record) {
        const db = await this.dbPromise;
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('Failed to persist request'));
            tx.onabort = () => reject(tx.error ?? new Error('Request persistence aborted'));
        });
    }
    openDatabase() {
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
//# sourceMappingURL=offlineQueue.js.map