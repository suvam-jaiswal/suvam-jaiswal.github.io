import { nanoid } from 'nanoid';
import { HttpEventHub } from './eventHub.js';
import { HttpStream } from './httpStream.js';
import { OfflineRequestQueue, type OfflineQueueOptions } from './offlineQueue.js';
import {
  HttpRequestError,
  RequestDispatcher,
  type ResponseParser,
} from './requestDispatcher.js';
import { SyncCoordinator } from './syncCoordinator.js';
import {
  type HttpMethod,
  type HttpRequestConfig,
  type HttpResponseType,
  type HttpStreamEvent,
  type QueueMetrics,
  type SerializedBody,
  type SerializedRequestInit,
  type StoredRequest,
} from '../types.js';
import {
  serializeBody,
  serializeError,
  serializeHeaders,
  serializeRequestInit,
} from './serialization.js';

interface PreparedRequest<TResponse = unknown> {
  id: string;
  method: HttpMethod;
  url: string;
  init: RequestInit;
  body?: BodyInit;
  serializedInit: SerializedRequestInit;
  serializedBody?: SerializedBody;
  metadata?: Record<string, unknown>;
  responseType: HttpResponseType;
  responseParserKey?: string;
  inlineParser?: (response: Response) => Promise<TResponse>;
  queueWhenOffline: boolean;
  queueWhenOnlineFails: boolean;
  maxRetries?: number;
  retryDelays?: number[];
  priority: StoredRequest['priority'];
}

export interface HttpClientOptions extends OfflineQueueOptions {
  retryDelays?: number[];
  maxRetries?: number;
  defaultResponseType?: HttpResponseType;
  queueWhenOffline?: boolean;
  queueWhenOnlineFails?: boolean;
  isOnline?: () => boolean;
  autoStart?: boolean;
  responseParsers?: Record<string, ResponseParser>;
}

const DEFAULT_RETRY_DELAYS = [1000, 3000, 10000, 30000];

export class OfflineHttpClient {
  readonly events = new HttpEventHub();
  private readonly queue: OfflineRequestQueue;
  private readonly dispatcher = new RequestDispatcher();
  private readonly sync: SyncCoordinator;
  private readonly parserRegistry = new Map<string, ResponseParser>();
  private readonly defaults: Required<
    Pick<
      HttpClientOptions,
      'retryDelays' | 'maxRetries' | 'defaultResponseType' | 'queueWhenOffline' | 'queueWhenOnlineFails'
    >
  >;
  private readonly isOnlineFn: () => boolean;

  constructor(private readonly baseOptions: HttpClientOptions = {}) {
    this.defaults = {
      retryDelays: baseOptions.retryDelays ?? DEFAULT_RETRY_DELAYS,
      maxRetries: baseOptions.maxRetries ?? 5,
      defaultResponseType: baseOptions.defaultResponseType ?? 'json',
      queueWhenOffline: baseOptions.queueWhenOffline ?? true,
      queueWhenOnlineFails: baseOptions.queueWhenOnlineFails ?? true,
    };

    this.isOnlineFn = baseOptions.isOnline ?? (() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

    this.queue = new OfflineRequestQueue({
      dbName: baseOptions.dbName,
    });

    if (baseOptions.responseParsers) {
      for (const [key, parser] of Object.entries(baseOptions.responseParsers)) {
        this.registerParser(key, parser);
      }
    }

    this.sync = new SyncCoordinator(
      this.queue,
      this.dispatcher,
      this.events,
      (key) => (key ? this.parserRegistry.get(key) : undefined),
      {
        retryDelays: this.defaults.retryDelays,
        isOnline: this.isOnlineFn,
        autoStart: baseOptions.autoStart,
      }
    );
  }

  get eventTarget(): EventTarget {
    return this.events.asEventTarget();
  }

  registerParser(key: string, parser: ResponseParser): void {
    this.parserRegistry.set(key, parser);
  }

  unregisterParser(key: string): void {
    this.parserRegistry.delete(key);
  }

  async metrics(): Promise<HttpClientMetrics> {
    const metrics = await this.sync.metrics();
    const pending = await this.queue.list('pending');
    return {
      ...metrics,
      pendingRequests: pending,
    };
  }

  async listQueued(): Promise<StoredRequest[]> {
    return this.queue.all();
  }

  async remove(id: string): Promise<void> {
    await this.queue.delete(id);
  }

  async retry(id: string): Promise<void> {
    const request = await this.queue.get(id);
    if (!request) {
      return;
    }

    await this.queue.update(id, { status: 'pending' });
    this.events.emit('request:requeued', { request });
    if (this.isOnline()) {
      void this.sync.drain();
    }
  }

  request<TResponse = unknown>(
    method: HttpMethod,
    url: string,
    config: HttpRequestConfig<TResponse> = {}
  ): HttpStream<HttpStreamEvent<TResponse>> {
    return new HttpStream<HttpStreamEvent<TResponse>>((observer) => {
      const abortController = new AbortController();
      const externalSignal = config.signal;
      if (externalSignal) {
        if (externalSignal.aborted) {
          abortController.abort(externalSignal.reason);
        } else {
          externalSignal.addEventListener(
            'abort',
            () => abortController.abort(externalSignal.reason),
            { once: true }
          );
        }
      }

      void this.prepareRequest(method, url, config)
        .then(async (prepared) => {
          const isOnline = this.isOnline();

          if (!isOnline && prepared.queueWhenOffline) {
            const stored = await this.enqueue(prepared, true);
            observer.next?.({
              type: 'scheduled',
              requestId: stored.id,
              offline: true,
              queuedAt: stored.createdAt,
              metadata: stored.metadata,
            });
            observer.complete?.();
            return;
          }

          try {
            const parser =
              prepared.inlineParser ??
              (prepared.responseParserKey
                ? (this.parserRegistry.get(prepared.responseParserKey) as
                    | ResponseParser<TResponse>
                    | undefined)
                : undefined);

            const { data, response } = await this.dispatcher.execute<TResponse>({
              method,
              url,
              requestInit: { ...prepared.init, signal: abortController.signal },
              body: prepared.body,
              responseType: prepared.responseType,
              parser,
            });

            observer.next?.({
              type: 'response',
              requestId: prepared.id,
              response,
              data,
            });
            observer.complete?.();
          } catch (error) {
            if (prepared.queueWhenOnlineFails && this.shouldQueueAfterFailure(error)) {
              const stored = await this.enqueue(prepared, false, error);
              const delay = this.defaults.retryDelays[0] ?? 0;
              observer.next?.({
                type: 'retry',
                requestId: stored.id,
                attempt: 1,
                delay,
                nextAttemptAt: Date.now() + delay,
              });
              observer.complete?.();
              return;
            }

            observer.error?.({
              type: 'error',
              requestId: prepared.id,
              error,
              attempt: 1,
              retriable: this.shouldQueueAfterFailure(error),
            });
          }
        })
        .catch((error) => {
          observer.error?.({
            type: 'error',
            requestId: nanoid(),
            error,
            attempt: 0,
            retriable: false,
          });
        });

      return () => {
        abortController.abort();
      };
    });
  }

  get<TResponse = unknown>(url: string, config?: HttpRequestConfig<TResponse>): HttpStream<HttpStreamEvent<TResponse>> {
    return this.request('GET', url, config);
  }

  delete<TResponse = unknown>(
    url: string,
    config?: HttpRequestConfig<TResponse>
  ): HttpStream<HttpStreamEvent<TResponse>> {
    return this.request('DELETE', url, config);
  }

  head<TResponse = unknown>(url: string, config?: HttpRequestConfig<TResponse>): HttpStream<HttpStreamEvent<TResponse>> {
    return this.request('HEAD', url, config);
  }

  options<TResponse = unknown>(
    url: string,
    config?: HttpRequestConfig<TResponse>
  ): HttpStream<HttpStreamEvent<TResponse>> {
    return this.request('OPTIONS', url, config);
  }

  post<TResponse = unknown>(
    url: string,
    config?: HttpRequestConfig<TResponse>
  ): HttpStream<HttpStreamEvent<TResponse>> {
    return this.request('POST', url, config);
  }

  put<TResponse = unknown>(
    url: string,
    config?: HttpRequestConfig<TResponse>
  ): HttpStream<HttpStreamEvent<TResponse>> {
    return this.request('PUT', url, config);
  }

  patch<TResponse = unknown>(
    url: string,
    config?: HttpRequestConfig<TResponse>
  ): HttpStream<HttpStreamEvent<TResponse>> {
    return this.request('PATCH', url, config);
  }

  private isOnline(): boolean {
    return this.isOnlineFn();
  }

  private shouldQueueAfterFailure(error: unknown): boolean {
    if (error instanceof HttpRequestError) {
      return error.response.status >= 500 || error.response.status === 0;
    }

    if (error instanceof TypeError) {
      return true;
    }

    return false;
  }

  private async prepareRequest<TResponse>(
    method: HttpMethod,
    url: string,
    config: HttpRequestConfig<TResponse>
  ): Promise<PreparedRequest<TResponse>> {
    const id = config.requestId ?? nanoid();
    const headers = new Headers(config.headers ?? {});
    let body = config.body ?? undefined;

    if (isPlainObject(body)) {
      headers.set('content-type', headers.get('content-type') ?? 'application/json');
      body = JSON.stringify(body);
    }

    const init: RequestInit = {
      cache: config.cache,
      credentials: config.credentials,
      integrity: config.integrity,
      keepalive: config.keepalive,
      method,
      mode: config.mode,
      redirect: config.redirect,
      referrer: config.referrer,
      referrerPolicy: config.referrerPolicy,
      headers,
    };

    const serializedHeaders = serializeHeaders(headers);
    const serializedInit = serializeRequestInit(init, serializedHeaders);
    const serializedBody = await serializeBody(body as BodyInit | null);

    return {
      id,
      method,
      url,
      init,
      body: body as BodyInit | undefined,
      serializedInit,
      serializedBody,
      metadata: config.metadata,
      responseType: config.responseType ?? this.defaults.defaultResponseType,
      responseParserKey: config.responseParserKey,
      inlineParser: config.parseResponse,
      queueWhenOffline: config.queueWhenOffline ?? this.defaults.queueWhenOffline,
      queueWhenOnlineFails:
        config.queueWhenOnlineFails ?? this.defaults.queueWhenOnlineFails,
      maxRetries: config.maxRetries ?? this.defaults.maxRetries,
      retryDelays: config.retryDelays ?? this.defaults.retryDelays,
      priority: config.queuePriority ?? 'normal',
    };
  }

  private async enqueue(
    prepared: PreparedRequest,
    offline: boolean,
    error?: unknown
  ): Promise<StoredRequest> {
    const stored = await this.queue.enqueue({
      id: prepared.id,
      method: prepared.method,
      url: prepared.url,
      requestInit: prepared.serializedInit,
      body: prepared.serializedBody,
      metadata: prepared.metadata,
      responseType: prepared.responseType,
      responseParserKey: prepared.responseParserKey,
      maxRetries: prepared.maxRetries,
      retryDelays: prepared.retryDelays,
      priority: prepared.priority,
      lastError: error ? serializeError(error) : undefined,
    });

    this.events.emit(offline ? 'request:queued' : 'request:requeued', { request: stored });

    if (!offline && this.isOnline()) {
      void this.sync.drain();
    }

    return stored;
  }
}

const plainObjectTag = '[object Object]';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === plainObjectTag;

export interface HttpClientMetrics extends QueueMetrics {
  pendingRequests: StoredRequest[];
}
