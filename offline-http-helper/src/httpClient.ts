import { nanoid } from 'nanoid';
import { HttpEventBus } from './events/eventBus.js';
import { HttpObservable } from './httpObservable.js';
import { IndexedDbQueue } from './storage/indexedDbQueue.js';
import { SyncManager } from './syncManager.js';
import { NetworkStatus } from './utils/network.js';
import { deserializeBody, headersToObject, mergeHeaders, serializeBody } from './utils/serialization.js';
import type {
  EventListenerMap,
  HttpClientOptions,
  HttpError,
  HttpEventName,
  HttpRequestConfig,
  HttpResponse,
  SerializedBody,
  StoredRequest,
} from './types.js';

export interface RequestResult<T = unknown> {
  requestId: string;
  response?: HttpResponse<T>;
  queued?: boolean;
}

export class HttpClient {
  readonly events: HttpEventBus;
  private queue: IndexedDbQueue;
  private syncManager: SyncManager;
  private networkStatus: NetworkStatus;
  private defaultHeaders: Record<string, string>;
  private baseUrl: string | undefined;
  private maxRetries: number;

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = options.baseUrl;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.maxRetries = options.maxRetries ?? 3;
    this.events = new HttpEventBus();
    this.queue = new IndexedDbQueue();
    this.networkStatus = new NetworkStatus(options.backgroundSyncInterval ?? 15000);
    this.syncManager = new SyncManager({
      queue: this.queue,
      eventBus: this.events,
      maxRetries: this.maxRetries,
      execute: (config, body, stored) => this.executeOnline(config, body, stored ?? null),
    });

    if (options.autoStart !== false) {
      this.start();
    }
  }

  start(): void {
    this.networkStatus.subscribe((online) => {
      if (online) {
        void this.syncManager.syncAll();
      }
    });
  }

  on(listeners: EventListenerMap): () => void {
    const removers: Array<() => void> = [];
    for (const [event, handler] of Object.entries(listeners) as Array<[HttpEventName, EventListenerMap[HttpEventName]]>) {
      if (!handler) continue;
      removers.push(this.events.on(event, handler as any));
    }
    return () => removers.forEach((remove) => remove());
  }

  request<TResponse = unknown, TBody = any>(config: HttpRequestConfig<TBody>): HttpObservable<RequestResult<TResponse>> {
    const requestId = config.id ?? nanoid();
    const preparedConfig: HttpRequestConfig<TBody> = {
      ...config,
      id: requestId,
      method: config.method,
      url: config.url,
      headers: mergeHeaders(this.defaultHeaders, config.headers),
    };

    const baseUrl = config.baseUrl ?? this.baseUrl;
    if (baseUrl !== undefined) {
      preparedConfig.baseUrl = baseUrl;
    }

    return new HttpObservable<RequestResult<TResponse>>((observer) => {
      const run = async () => {
        const online = this.networkStatus.isOnline();
        const serialized = await serializeBody(preparedConfig.body);

        if (!online && preparedConfig.requireOnline) {
          const error = this.createError('Request requires connectivity', preparedConfig, requestId, true);
          this.events.emit('request:error', { error, request: null });
          observer.error?.(error);
          return;
        }

        if (!online) {
          const stored: StoredRequest = {
            id: requestId,
            config: preparedConfig,
            body: serialized,
            attempts: 0,
            createdAt: Date.now(),
          };
          await this.queue.enqueue(stored);
          this.events.emit('request:queued', { request: stored });
          observer.next?.({ requestId, queued: true });
          observer.complete?.();
          return;
        }

        try {
          const response = await this.executeOnline<TResponse>(preparedConfig, serialized, null);
          observer.next?.({ requestId, response });
          observer.complete?.();
        } catch (error) {
          const typedError = this.normalizeError(error, preparedConfig, requestId, false);
          this.events.emit('request:error', { error: typedError, request: null });
          observer.error?.(typedError);
        }
      };

      run();
      return () => {
        // noop teardown
      };
    });
  }

  get<TResponse = unknown>(url: string, config: Partial<HttpRequestConfig> = {}): HttpObservable<RequestResult<TResponse>> {
    return this.request<TResponse>({ ...config, method: 'GET', url });
  }

  delete<TResponse = unknown>(url: string, config: Partial<HttpRequestConfig> = {}): HttpObservable<RequestResult<TResponse>> {
    return this.request<TResponse>({ ...config, method: 'DELETE', url });
  }

  post<TResponse = unknown, TBody = any>(
    url: string,
    body?: TBody,
    config: Partial<HttpRequestConfig<TBody>> = {},
  ): HttpObservable<RequestResult<TResponse>> {
    const finalConfig: HttpRequestConfig<TBody> = { ...(config as HttpRequestConfig<TBody>), method: 'POST', url };
    if (body !== undefined) {
      finalConfig.body = body;
    }
    return this.request<TResponse, TBody>(finalConfig);
  }

  put<TResponse = unknown, TBody = any>(
    url: string,
    body?: TBody,
    config: Partial<HttpRequestConfig<TBody>> = {},
  ): HttpObservable<RequestResult<TResponse>> {
    const finalConfig: HttpRequestConfig<TBody> = { ...(config as HttpRequestConfig<TBody>), method: 'PUT', url };
    if (body !== undefined) {
      finalConfig.body = body;
    }
    return this.request<TResponse, TBody>(finalConfig);
  }

  patch<TResponse = unknown, TBody = any>(
    url: string,
    body?: TBody,
    config: Partial<HttpRequestConfig<TBody>> = {},
  ): HttpObservable<RequestResult<TResponse>> {
    const finalConfig: HttpRequestConfig<TBody> = { ...(config as HttpRequestConfig<TBody>), method: 'PATCH', url };
    if (body !== undefined) {
      finalConfig.body = body;
    }
    return this.request<TResponse, TBody>(finalConfig);
  }

  head<TResponse = unknown>(url: string, config: Partial<HttpRequestConfig> = {}): HttpObservable<RequestResult<TResponse>> {
    return this.request<TResponse>({ ...config, method: 'HEAD', url });
  }

  options<TResponse = unknown>(
    url: string,
    config: Partial<HttpRequestConfig> = {},
  ): HttpObservable<RequestResult<TResponse>> {
    return this.request<TResponse>({ ...config, method: 'OPTIONS', url });
  }

  async listQueuedRequests(): Promise<StoredRequest[]> {
    return this.queue.getAll();
  }

  async listDeadLetters() {
    return this.queue.listDeadLetter();
  }

  async triggerSync(): Promise<void> {
    return this.syncManager.syncAll();
  }

  private async executeOnline<TResponse = unknown>(
    config: HttpRequestConfig,
    serializedBody: SerializedBody,
    stored: StoredRequest | null,
  ): Promise<HttpResponse<TResponse>> {
    const requestId = config.id ?? stored?.id ?? nanoid();
    const url = this.resolveUrl(config);
    const headers = config.headers ?? {};
    const init: RequestInit = {
      method: config.method,
      headers,
    };

    if (serializedBody.type !== 'null') {
      init.body = await deserializeBody(serializedBody);
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      const offlineError = this.createError('Network request failed', config, requestId, true, error);
      if (!config.requireOnline) {
        const storedRequest: StoredRequest =
          stored ?? {
            id: requestId,
            config,
            body: serializedBody,
            attempts: 0,
            createdAt: Date.now(),
          };
        await this.queue.enqueue(storedRequest);
        this.events.emit('request:queued', { request: storedRequest });
      }
      this.events.emit('request:error', { error: offlineError, request: stored ?? null });
      throw offlineError;
    }

    const parsed = await this.parseResponse<TResponse>(response, config.responseType);
    const httpResponse: HttpResponse<TResponse> = {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
      headers: headersToObject(response.headers),
      data: parsed,
      requestId,
      url,
    };

    if (!response.ok) {
      const error = this.createError(`Request failed with status ${response.status}`, config, requestId, false, parsed);
      error.status = response.status;
      error.retriable = response.status >= 500;
      throw error;
    }

    this.events.emit('request:success', { response: httpResponse, request: stored });
    return httpResponse;
  }

  private resolveUrl(config: HttpRequestConfig): string {
    if (!config.baseUrl && !this.baseUrl) {
      return config.url;
    }
    const base = config.baseUrl ?? this.baseUrl ?? '';
    return new URL(config.url, base).toString();
  }

  private async parseResponse<T>(response: Response, responseType: HttpRequestConfig['responseType']): Promise<T> {
    const type = responseType ?? this.detectResponseType(response);
    switch (type) {
      case 'arrayBuffer':
        return (await response.arrayBuffer()) as unknown as T;
      case 'blob':
        return (await response.blob()) as unknown as T;
      case 'formData':
        return (await response.formData()) as unknown as T;
      case 'text':
        return (await response.text()) as unknown as T;
      case 'json':
      default:
        const text = await response.text();
        try {
          return text ? (JSON.parse(text) as T) : (null as T);
        } catch (error) {
          return text as unknown as T;
        }
    }
  }

  private detectResponseType(response: Response): HttpRequestConfig['responseType'] {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) return 'json';
    if (contentType.includes('text/')) return 'text';
    if (contentType.includes('form-data')) return 'formData';
    if (contentType.includes('application/octet-stream')) return 'arrayBuffer';
    return 'blob';
  }

  private createError(
    message: string,
    config: HttpRequestConfig,
    requestId: string,
    isOffline: boolean,
    cause?: unknown,
  ): HttpError {
    const error = new Error(message) as HttpError;
    error.requestId = requestId;
    error.isOffline = isOffline;
    error.cause = cause;
    error.retriable = !config.requireOnline;
    return error;
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
    err.retriable = !config.requireOnline;
    return err;
  }
}
