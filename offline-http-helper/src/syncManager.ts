import { HttpEventBus } from './events/eventBus.js';
import type { HttpError, HttpRequestConfig, HttpResponse, SerializedBody, StoredRequest, SyncStats } from './types.js';
import { IndexedDbQueue } from './storage/indexedDbQueue.js';

export interface SyncContext {
  queue: IndexedDbQueue;
  eventBus: HttpEventBus;
  maxRetries: number;
  execute(config: HttpRequestConfig, body: SerializedBody, stored?: StoredRequest): Promise<HttpResponse>;
}

export class SyncManager {
  private processing = false;
  private pendingPromise: Promise<void> | null = null;

  constructor(private ctx: SyncContext) {}

  async syncAll(): Promise<void> {
    if (this.processing) {
      return this.pendingPromise ?? Promise.resolve();
    }
    this.processing = true;
    const stats: SyncStats = {
      total: (await this.ctx.queue.getAll()).length,
      processed: 0,
      failed: 0,
    };

    this.ctx.eventBus.emit('sync:started', { stats: { ...stats } });

    this.pendingPromise = (async () => {
      let request: StoredRequest | undefined;
      while ((request = await this.ctx.queue.next())) {
        stats.total = stats.total === 0 ? 1 : stats.total;
        stats.processed += 1;
        this.ctx.eventBus.emit('sync:progress', { stats: { ...stats }, request });
        try {
          const response = await this.ctx.execute(request.config, request.body, request);
          this.ctx.eventBus.emit('request:success', { response, request });
        } catch (error) {
          stats.failed += 1;
          const typedError = this.normalizeError(error, request.config, request.id, false);
          typedError.retriable = this.shouldRetry(request);
          if (typedError.retriable) {
            const updated: StoredRequest = {
              ...request,
              attempts: request.attempts + 1,
              lastError: typedError.message,
            };
            await this.ctx.queue.enqueue(updated);
          } else {
            await this.ctx.queue.addToDeadLetter(request);
            this.ctx.eventBus.emit('request:permanent-failure', { error: typedError, request });
          }
          this.ctx.eventBus.emit('request:error', { error: typedError, request });
          this.ctx.eventBus.emit('sync:error', { error: typedError, stats: { ...stats }, request });
        }
      }
      this.ctx.eventBus.emit('sync:completed', { stats: { ...stats } });
      this.processing = false;
      this.pendingPromise = null;
    })();

    return this.pendingPromise;
  }

  private shouldRetry(request: StoredRequest): boolean {
    const maxRetries = request.config.maxRetries ?? this.ctx.maxRetries;
    return request.attempts + 1 < maxRetries;
  }

  private normalizeError(error: unknown, config: HttpRequestConfig, requestId: string, isOffline: boolean): HttpError {
    if (error && typeof error === 'object' && 'requestId' in error) {
      return error as HttpError;
    }
    const err = new Error((error as Error)?.message ?? 'Request failed') as HttpError;
    err.requestId = requestId;
    if (error instanceof Response) {
      err.status = error.status;
    }
    err.cause = error;
    err.isOffline = isOffline;
    return err;
  }
}
