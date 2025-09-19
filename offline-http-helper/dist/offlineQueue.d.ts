import type { HttpMethod, OfflineQueueOptions, QueuedRequestPayload, ResponseType, SerializedError, SerializedRequestInit } from './types.js';
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
export declare class OfflineQueue {
    private readonly dbName;
    private readonly dbVersion;
    private readonly dbPromise;
    constructor(options?: OfflineQueueOptions);
    enqueue(options: EnqueueOptions): Promise<QueuedRequestPayload>;
    getAll(): Promise<QueuedRequestPayload[]>;
    get(id: string): Promise<QueuedRequestPayload | undefined>;
    update(id: string, update: Partial<QueuedRequestPayload>): Promise<QueuedRequestPayload | undefined>;
    remove(id: string): Promise<void>;
    clear(): Promise<void>;
    close(): Promise<void>;
    private put;
    private openDatabase;
}
//# sourceMappingURL=offlineQueue.d.ts.map