import { HttpEventBus, createEventBus } from './events.js';
import { HttpObservable } from './httpObservable.js';
import type {
  HttpClientConfig,
  HttpMethod,
  HttpRequestOptions,
  HttpRequestResult,
  HttpResponse,
  SerializedRequestInit,
} from './types.js';
import { OfflineQueue } from './offlineQueue.js';
import { HttpSyncManager } from './syncManager.js';
import { RequestSerializer } from './requestSerializer.js';
import { HttpStatusError, NetworkHttpError, NetworkOfflineError, toSerializedError } from './errors.js';
import { mergeHeaders, isBrowserOnline } from './utils.js';
import { parseResponse } from './response.js';

interface RequestExecutionContext {
  queueOffline: boolean;
  queueOnError: boolean;
  responseType: HttpRequestOptions['responseType'];
  metadata?: Record<string, unknown>;
}

export class HttpClient {
  private readonly queue: OfflineQueue;
  private readonly events: HttpEventBus;
  private readonly syncManager: HttpSyncManager;
  private readonly baseUrl?: string;
  private readonly defaultOptions: HttpRequestOptions;

  constructor(config: HttpClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? undefined;
    const defaults: HttpRequestOptions = { ...config.defaultOptions };
    defaults.queueOffline = config.defaultOptions?.queueOffline ?? true;
    defaults.queueOnError = config.defaultOptions?.queueOnError ?? true;
    defaults.responseType = config.defaultOptions?.responseType ?? 'json';
    const mergedHeaders = mergeHeaders(undefined, config.defaultOptions?.headers);
    if (mergedHeaders) {
      defaults.headers = mergedHeaders;
    }
    if (config.defaultOptions?.metadata) {
      defaults.metadata = { ...config.defaultOptions.metadata };
    }
    this.defaultOptions = defaults;
    this.events = createEventBus();
    this.queue = new OfflineQueue(config.offlineQueue);
    this.syncManager = new HttpSyncManager(this.queue, this.events, config.sync);
  }

  get eventBus(): HttpEventBus {
    return this.events;
  }

  getQueue(): OfflineQueue {
    return this.queue;
  }

  getSyncManager(): HttpSyncManager {
    return this.syncManager;
  }

  request<T = unknown>(method: HttpMethod, url: string, options: HttpRequestOptions = {}): HttpObservable<HttpRequestResult<T>> {
    const mergedOptions = this.mergeOptions(options);
    const targetUrl = this.resolveUrl(url);

    const {
      queueOffline = true,
      queueOnError = true,
      responseType = 'json',
      metadata,
      signal,
      headers: _headers,
      body: rawBody,
      ...rest
    } = mergedOptions;

    const normalized = this.normalizeBody(rawBody as BodyInit | Record<string, unknown> | undefined, _headers);
    const fetchInit: RequestInit = { ...rest };
    if (normalized.headers) {
      fetchInit.headers = normalized.headers;
    }
    if (normalized.body !== undefined) {
      fetchInit.body = normalized.body;
    }
    if (signal !== undefined) {
      fetchInit.signal = signal;
    }

    const context: RequestExecutionContext = {
      queueOffline,
      queueOnError,
      responseType,
    };
    if (metadata) {
      context.metadata = metadata;
    }

    return new HttpObservable<HttpRequestResult<T>>((observer) => {
      const abortController = !signal ? new AbortController() : undefined;
      const fetchSignal = signal ?? abortController?.signal;
      let serializedInit: SerializedRequestInit | undefined;

      const getSerializedInit = async (): Promise<SerializedRequestInit> => {
        if (!serializedInit) {
          serializedInit = await this.serializeForQueue(fetchInit);
        }
        return serializedInit;
      };

      const execute = async (): Promise<void> => {
        try {
          if (!isBrowserOnline()) {
            if (context.queueOffline) {
              await this.queueAndNotify(targetUrl, method, await getSerializedInit(), context, observer);
              return;
            }
            const offlineError = new NetworkOfflineError();
            this.dispatchRequestError(targetUrl, method, offlineError, context.metadata);
            observer.error?.(offlineError);
            return;
          }

          const response = await fetch(targetUrl, {
            ...fetchInit,
            method,
            signal: fetchSignal ?? null,
          });
          const parsed = await parseResponse<T>(response, context.responseType ?? 'json', 'network');
          if (!response.ok) {
            const error = new NetworkHttpError(parsed as HttpResponse<T>);
            this.dispatchRequestError(targetUrl, method, error, context.metadata);
            observer.error?.(error);
            return;
          }
          observer.next?.({ kind: 'response', response: parsed });
          observer.complete?.();
        } catch (error) {
          if (this.shouldQueueAfterError(error) && context.queueOnError) {
            await this.queueAndNotify(targetUrl, method, await getSerializedInit(), context, observer);
            return;
          }
          this.dispatchRequestError(targetUrl, method, error, context.metadata);
          observer.error?.(error);
        }
      };

      void execute();

      return () => {
        abortController?.abort();
      };
    });
  }

  get<T = unknown>(url: string, options?: HttpRequestOptions): HttpObservable<HttpRequestResult<T>> {
    return this.request<T>('GET', url, options);
  }

  delete<T = unknown>(url: string, options?: HttpRequestOptions): HttpObservable<HttpRequestResult<T>> {
    return this.request<T>('DELETE', url, options);
  }

  head<T = unknown>(url: string, options?: HttpRequestOptions): HttpObservable<HttpRequestResult<T>> {
    return this.request<T>('HEAD', url, options);
  }

  options<T = unknown>(url: string, options?: HttpRequestOptions): HttpObservable<HttpRequestResult<T>> {
    return this.request<T>('OPTIONS', url, options);
  }

  post<T = unknown>(url: string, body?: BodyInit | Record<string, unknown>, options: HttpRequestOptions = {}): HttpObservable<HttpRequestResult<T>> {
    const requestOptions: HttpRequestOptions = {
      ...options,
      ...(body !== undefined ? { body: body as unknown as BodyInit } : {}),
    };
    return this.request<T>('POST', url, requestOptions);
  }

  put<T = unknown>(url: string, body?: BodyInit | Record<string, unknown>, options: HttpRequestOptions = {}): HttpObservable<HttpRequestResult<T>> {
    const requestOptions: HttpRequestOptions = {
      ...options,
      ...(body !== undefined ? { body: body as unknown as BodyInit } : {}),
    };
    return this.request<T>('PUT', url, requestOptions);
  }

  patch<T = unknown>(url: string, body?: BodyInit | Record<string, unknown>, options: HttpRequestOptions = {}): HttpObservable<HttpRequestResult<T>> {
    const requestOptions: HttpRequestOptions = {
      ...options,
      ...(body !== undefined ? { body: body as unknown as BodyInit } : {}),
    };
    return this.request<T>('PATCH', url, requestOptions);
  }

  async syncNow(): Promise<void> {
    await this.syncManager.replayPending();
  }

  dispose(): void {
    this.syncManager.dispose();
  }

  private mergeOptions(options: HttpRequestOptions): HttpRequestOptions {
    const merged: HttpRequestOptions = { ...this.defaultOptions, ...options };
    const mergedHeaders = mergeHeaders(this.defaultOptions.headers, options.headers);
    if (mergedHeaders) {
      merged.headers = mergedHeaders;
    }
    const metadataSources = [this.defaultOptions.metadata, options.metadata].filter(Boolean) as Array<
      Record<string, unknown>
    >;
    if (metadataSources.length > 0) {
      merged.metadata = Object.assign({}, ...metadataSources);
    }
    merged.queueOffline = options.queueOffline ?? this.defaultOptions.queueOffline ?? true;
    merged.queueOnError = options.queueOnError ?? this.defaultOptions.queueOnError ?? true;
    merged.responseType = options.responseType ?? this.defaultOptions.responseType ?? 'json';
    return merged;
  }

  private resolveUrl(url: string): string {
    if (!this.baseUrl) {
      return url;
    }
    if (/^https?:\/\//i.test(url)) {
      return url;
    }
    try {
      return new URL(url, this.baseUrl).toString();
    } catch {
      return `${this.baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
    }
  }

  private shouldQueueAfterError(error: unknown): boolean {
    if (!isBrowserOnline()) {
      return true;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      return false;
    }
    if (error instanceof HttpStatusError) {
      return false;
    }
    if (typeof error === 'object' && error instanceof TypeError) {
      return true;
    }
    return false;
  }

  private async serializeForQueue(init: RequestInit): Promise<SerializedRequestInit> {
    const { signal: _signal, ...serializable } = init;
    return RequestSerializer.serializeRequestInit(serializable);
  }

  private async queueAndNotify<T>(
    url: string,
    method: HttpMethod,
    serializedInit: SerializedRequestInit,
    context: RequestExecutionContext,
    observer: {
      next?: (value: HttpRequestResult<T>) => void;
      complete?: () => void;
    },
  ): Promise<void> {
    const queued = await this.queue.enqueue({
      url,
      method,
      requestInit: serializedInit,
      ...(context.metadata ? { metadata: context.metadata } : {}),
      responseType: context.responseType ?? 'json',
    });
    this.events.emit('requestqueued', { request: queued });
    observer.next?.({ kind: 'queued', request: queued });
    observer.complete?.();
  }

  private dispatchRequestError(
    url: string,
    method: HttpMethod,
    error: unknown,
    metadata?: Record<string, unknown>,
  ): void {
    const serialized = toSerializedError(error);
    this.events.emit('requesterror', {
      error: serialized,
      request: {
        url,
        method,
        ...(metadata ? { metadata } : {}),
      },
    });
  }

  private normalizeBody(
    body: BodyInit | Record<string, unknown> | null | undefined,
    headers: HeadersInit | undefined,
  ): { body?: BodyInit | null; headers?: HeadersInit } {
    if (body === undefined) {
      return headers ? { headers } : {};
    }
    if (body === null) {
      const result: { body: BodyInit | null; headers?: HeadersInit } = { body: null };
      if (headers) {
        result.headers = headers;
      }
      return result;
    }
    if (isSupportedBody(body)) {
      const result: { body: BodyInit; headers?: HeadersInit } = { body };
      if (headers) {
        result.headers = headers;
      }
      return result;
    }
    if (typeof body === 'object') {
      const normalizedHeaders = mergeHeaders(headers, [['Content-Type', 'application/json']]);
      const result: { body: BodyInit; headers?: HeadersInit } = { body: JSON.stringify(body) };
      if (normalizedHeaders) {
        result.headers = normalizedHeaders;
      }
      return result;
    }
    const result: { body: BodyInit; headers?: HeadersInit } = { body: body as BodyInit };
    if (headers) {
      result.headers = headers;
    }
    return result;
  }
}

function isSupportedBody(value: unknown): value is BodyInit {
  if (typeof value === 'string') {
    return true;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return true;
  }
  if (typeof FormData !== 'undefined' && value instanceof FormData) {
    return true;
  }
  if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) {
    return true;
  }
  if (value instanceof ArrayBuffer) {
    return true;
  }
  if (ArrayBuffer.isView(value)) {
    return true;
  }
  if (ArrayBuffer.isView(value)) {
    return true;
  }
  if (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream) {
    return true;
  }
  return false;
}

