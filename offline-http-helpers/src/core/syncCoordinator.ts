import { HttpEventHub } from './eventHub.js';
import { OfflineRequestQueue } from './offlineQueue.js';
import { HttpRequestError, RequestDispatcher } from './requestDispatcher.js';
import { type QueueMetrics, type StoredRequest } from '../types.js';
import {
  deserializeBody,
  deserializeRequestInit,
  serializeError,
  summarizeResponse,
} from './serialization.js';

export interface SyncCoordinatorOptions {
  retryDelays?: number[];
  isOnline?: () => boolean;
  autoStart?: boolean;
}

const DEFAULT_RETRY_DELAYS = [1000, 3000, 10000, 30000];

export class SyncCoordinator {
  private readonly retryDelays: number[];
  private readonly isOnline: () => boolean;
  private syncing = false;
  private disposed = false;
  private listenersAttached = false;
  private lastSyncAt?: number;

  constructor(
    private readonly queue: OfflineRequestQueue,
    private readonly dispatcher: RequestDispatcher,
    private readonly events: HttpEventHub,
    private readonly parserResolver: (key?: string) => ((response: Response) => Promise<unknown>) | undefined,
    options: SyncCoordinatorOptions = {}
  ) {
    this.retryDelays = options.retryDelays ?? DEFAULT_RETRY_DELAYS;
    this.isOnline = options.isOnline ?? (() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

    if (options.autoStart ?? true) {
      void this.start();
    }
  }

  async start(): Promise<void> {
    if (this.listenersAttached) {
      return;
    }

    await this.queue.init();

    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', this.handleOnline);
      this.listenersAttached = true;
    }

    if (this.isOnline()) {
      void this.drain();
    }
  }

  stop(): void {
    if (this.listenersAttached && typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('online', this.handleOnline);
      this.listenersAttached = false;
    }
    this.disposed = true;
  }

  async drain(): Promise<void> {
    if (this.syncing || this.disposed || !this.isOnline()) {
      return;
    }

    this.syncing = true;
    try {
      const pending = await this.queue.list('pending');
      if (!pending.length) {
        return;
      }

      pending.sort((a, b) => a.priorityIndex - b.priorityIndex || a.createdAt - b.createdAt);
      this.events.emit('sync:drain-started', { pending: pending.length });

      for (const request of pending) {
        await this.processRequest(request);
      }

      const remaining = await this.queue.list('pending');
      this.lastSyncAt = Date.now();
      this.events.emit('sync:drain-complete', { pending: remaining.length });
    } finally {
      this.syncing = false;
    }
  }

  async metrics(): Promise<QueueMetrics> {
    const metrics = await this.queue.metrics();
    return { ...metrics, lastSyncAt: this.lastSyncAt };
  }

  private handleOnline = (): void => {
    if (!this.disposed) {
      void this.drain();
    }
  };

  private async processRequest(request: StoredRequest): Promise<void> {
    let current: StoredRequest | undefined = request;

    while (current && !this.disposed) {
      if (!this.isOnline()) {
        await this.queue.update(current.id, { status: 'pending' });
        return;
      }

      const attempt = (current.retries ?? 0) + 1;
      this.events.emit('request:sync-started', { request: current, attempt });
      await this.queue.update(current.id, { status: 'in-flight' });

      try {
        const requestInit = deserializeRequestInit(current.requestInit);
        const body = deserializeBody(current.body);
        const parser = this.parserResolver(current.responseParserKey);
        const { data, response } = await this.dispatcher.execute({
          method: current.method,
          url: current.url,
          requestInit,
          body,
          responseType: current.responseType,
          parser,
        });

        await this.queue.delete(current.id);
        const summary = summarizeResponse(response);
        this.events.emit('request:sync-success', {
          request: current,
          response: summary,
          data,
        });
        return;
      } catch (error) {
        const serialized = serializeError(error);
        const shouldRetry = this.shouldRetry(error, current, attempt);

        if (shouldRetry) {
          const delay = this.getRetryDelay(attempt, current);
          const updated =
            (await this.queue.update(current.id, {
              status: 'pending',
              retries: attempt,
              lastError: serialized,
            })) ?? current;

          this.events.emit('request:sync-error', {
            request: updated,
            error: serialized,
            attempt,
            willRetry: true,
          });

          if (delay > 0) {
            await wait(delay);
          }

          current = await this.queue.get(current.id);
          continue;
        }

        const failed =
          (await this.queue.update(current.id, {
            status: 'failed',
            retries: attempt,
            lastError: serialized,
          })) ?? current;

        this.events.emit('request:sync-error', {
          request: failed,
          error: serialized,
          attempt,
          willRetry: false,
        });
        this.events.emit('request:failed', { request: failed, error: serialized });
        return;
      }
    }
  }

  private shouldRetry(error: unknown, request: StoredRequest, attempt: number): boolean {
    if (request.maxRetries != null && attempt > request.maxRetries) {
      return false;
    }

    if (error instanceof HttpRequestError) {
      const status = error.response.status;
      return status >= 500 || status === 0;
    }

    if (error instanceof TypeError) {
      // Fetch throws TypeError on network failures.
      return true;
    }

    return false;
  }

  private getRetryDelay(attempt: number, request: StoredRequest): number {
    const strategy = request.retryDelays ?? this.retryDelays;
    const index = Math.min(attempt - 1, strategy.length - 1);
    return strategy[index] ?? 0;
  }
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
