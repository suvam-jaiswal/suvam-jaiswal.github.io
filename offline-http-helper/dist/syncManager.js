import { HttpEventBus } from './events.js';
import { ReplayHttpError, toSerializedError } from './errors.js';
import { OfflineQueue } from './offlineQueue.js';
import { parseResponse } from './response.js';
import { RequestSerializer } from './requestSerializer.js';
import { delay, isBrowserOnline, now } from './utils.js';
const DEFAULT_OPTIONS = {
    haltOnFailure: false,
    maxRetries: 5,
    baseRetryDelayMs: 1000,
    backoffMultiplier: 2,
    autoReplayOnOnline: true,
};
export class HttpSyncManager {
    constructor(queue, events, options = {}) {
        this.queue = queue;
        this.events = events;
        this.syncing = false;
        this.disposed = false;
        this.options = { ...DEFAULT_OPTIONS, ...options };
        if (this.options.autoReplayOnOnline && typeof window !== 'undefined') {
            const handler = () => {
                if (isBrowserOnline()) {
                    void this.replayPending();
                }
            };
            window.addEventListener('online', handler);
            this.removeOnlineListener = () => window.removeEventListener('online', handler);
        }
    }
    async replayPending() {
        if (this.syncing || this.disposed) {
            return;
        }
        if (!isBrowserOnline()) {
            return;
        }
        this.syncing = true;
        const stats = { processed: 0, succeeded: 0, failed: 0, remaining: 0 };
        try {
            const pending = (await this.queue.getAll()).sort((a, b) => a.createdAt - b.createdAt);
            stats.remaining = pending.length;
            this.events.emit('syncstart', { stats: { ...stats } });
            for (const request of pending) {
                if (!isBrowserOnline()) {
                    break;
                }
                if (request.nextAttemptAt && request.nextAttemptAt > now()) {
                    continue;
                }
                stats.processed += 1;
                try {
                    const response = await this.executeRequest(request);
                    stats.succeeded += 1;
                    await this.queue.remove(request.id);
                    stats.remaining -= 1;
                    this.events.emit('syncsuccess', {
                        stats: { ...stats },
                        request,
                        response,
                    });
                }
                catch (error) {
                    stats.failed += 1;
                    const serializedError = toSerializedError(error);
                    const attempts = (request.attempts ?? 0) + 1;
                    const shouldRetry = attempts < this.options.maxRetries;
                    const nextAttemptAt = shouldRetry
                        ? now() + this.options.baseRetryDelayMs * this.options.backoffMultiplier ** (attempts - 1)
                        : null;
                    await this.queue.update(request.id, {
                        attempts,
                        lastAttemptAt: now(),
                        lastError: serializedError,
                        nextAttemptAt,
                    });
                    this.events.emit('syncerror', {
                        stats: { ...stats },
                        request,
                        error: serializedError,
                    });
                    if (!shouldRetry && this.options.haltOnFailure) {
                        break;
                    }
                    if (shouldRetry && nextAttemptAt) {
                        await delay(this.options.baseRetryDelayMs);
                    }
                }
            }
            const remainingRequests = await this.queue.getAll();
            stats.remaining = remainingRequests.length;
            this.events.emit('synccomplete', {
                stats: { ...stats },
                remainingRequests,
            });
        }
        finally {
            this.syncing = false;
        }
    }
    async retryErroredRequest(options) {
        const stored = await this.queue.get(options.requestId);
        if (!stored) {
            return undefined;
        }
        const merged = {
            ...stored,
            ...(options.override?.metadata ? { metadata: options.override.metadata } : {}),
            ...(options.override?.requestInit ? { requestInit: options.override.requestInit } : {}),
            attempts: stored.attempts ?? 0,
        };
        try {
            const response = await this.executeRequest(merged);
            await this.queue.remove(merged.id);
            this.events.emit('replayresult', { request: merged, response });
            return { request: merged, response };
        }
        catch (error) {
            const serializedError = toSerializedError(error);
            await this.queue.update(merged.id, {
                lastError: serializedError,
                attempts: (merged.attempts ?? 0) + 1,
                lastAttemptAt: now(),
            });
            this.events.emit('replayresult', { request: merged, error: serializedError });
            return { request: merged, error: serializedError };
        }
    }
    dispose() {
        this.disposed = true;
        if (this.removeOnlineListener) {
            this.removeOnlineListener();
        }
    }
    async executeRequest(request) {
        const init = await RequestSerializer.deserializeRequestInit(request.requestInit);
        const response = await fetch(request.url, { ...init, method: request.method });
        const parsed = await parseResponse(response, request.responseType, 'replay', request.id);
        if (!response.ok) {
            throw new ReplayHttpError(parsed);
        }
        return parsed;
    }
}
//# sourceMappingURL=syncManager.js.map