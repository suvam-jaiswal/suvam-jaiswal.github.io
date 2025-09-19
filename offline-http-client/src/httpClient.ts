import { Observable } from './observable.js';
import type { Observer } from './observable.js';
import { SyncEventBus } from './events.js';
import type {
  HttpMethod,
  HttpRequestOptions,
  HttpResult,
  HttpSuccessResult,
  HttpQueuedResult,
  OfflineHttpClientOptions,
  ResponseType,
  StoredRequest,
  SyncErrorEventDetail,
  SyncEventRecord,
  SyncQueueEventDetail,
  SyncRetryEventDetail,
  SyncSuccessEventDetail,
  SerializedBody,
} from './types.js';
import {
  initDatabase,
  saveRequest,
  deleteRequest,
  listRequestsByState,
  updateRequest,
  saveEvent,
  getEventLog,
  pruneEvents,
  migrateFailedToPending,
} from './storage.js';
import type { OfflineHttpDatabase } from './storage.js';
import { serializeBody, deserializeBody } from './serialization.js';

const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 2000;
const DEFAULT_RESPONSE_TYPE: ResponseType = 'json';

export class OfflineHttpClient {
  private readonly dbPromise: Promise<OfflineHttpDatabase>;
  private readonly options: Required<Pick<OfflineHttpClientOptions, 'defaultRetries' | 'defaultRetryDelay' | 'queueRetentionMs' | 'autoStart'>>;
  private readonly requestStoreName: string;
  private readonly eventStoreName: string;
  private processing = false;
  private started = false;
  private onlineListener?: () => void;

  readonly events = new SyncEventBus();

  constructor(options: OfflineHttpClientOptions = {}) {
    this.options = {
      defaultRetries: options.defaultRetries ?? DEFAULT_RETRIES,
      defaultRetryDelay: options.defaultRetryDelay ?? DEFAULT_RETRY_DELAY,
      queueRetentionMs: options.queueRetentionMs ?? 1000 * 60 * 60 * 24 * 7,
      autoStart: options.autoStart ?? true,
    };
    this.requestStoreName = options.storeName ?? 'requests';
    this.eventStoreName = options.eventStoreName ?? 'events';
    this.dbPromise = initDatabase(options);

    if (this.options.autoStart) {
      void this.start();
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.dbPromise;
    if (typeof window !== 'undefined') {
      this.onlineListener = () => {
        if (this.isOnline()) {
          void this.processQueue();
        }
      };
      window.addEventListener('online', this.onlineListener);
    }
    if (this.isOnline()) {
      await this.processQueue();
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (typeof window !== 'undefined' && this.onlineListener) {
      window.removeEventListener('online', this.onlineListener);
    }
  }

  request<T = unknown>(method: HttpMethod, url: string, options: HttpRequestOptions = {}): Observable<HttpResult<T>> {
    return new Observable<HttpResult<T>>((observer) => {
      void this.handleRequest(method, url, options, observer).catch((error) => {
        observer.error(error);
      });
    });
  }

  get<T = unknown>(url: string, options?: HttpRequestOptions): Observable<HttpResult<T>> {
    return this.request<T>('GET', url, options);
  }

  post<T = unknown>(url: string, body?: unknown, options: HttpRequestOptions = {}): Observable<HttpResult<T>> {
    return this.request<T>('POST', url, { ...options, body });
  }

  put<T = unknown>(url: string, body?: unknown, options: HttpRequestOptions = {}): Observable<HttpResult<T>> {
    return this.request<T>('PUT', url, { ...options, body });
  }

  patch<T = unknown>(url: string, body?: unknown, options: HttpRequestOptions = {}): Observable<HttpResult<T>> {
    return this.request<T>('PATCH', url, { ...options, body });
  }

  delete<T = unknown>(url: string, options?: HttpRequestOptions): Observable<HttpResult<T>> {
    return this.request<T>('DELETE', url, options);
  }

  head<T = unknown>(url: string, options?: HttpRequestOptions): Observable<HttpResult<T>> {
    return this.request<T>('HEAD', url, options);
  }

  async getPendingRequests(): Promise<StoredRequest[]> {
    const db = await this.dbPromise;
    return listRequestsByState(db, this.requestStoreName, 'pending');
  }

  async getFailedRequests(): Promise<StoredRequest[]> {
    const db = await this.dbPromise;
    return listRequestsByState(db, this.requestStoreName, 'failed');
  }

  async retryFailed(ids?: string[]): Promise<void> {
    const db = await this.dbPromise;
    const failed = await this.getFailedRequests();
    const retryIds = ids?.length ? failed.filter((req) => ids.includes(req.id)).map((req) => req.id) : failed.map((req) => req.id);
    if (!retryIds.length) return;
    await migrateFailedToPending(db, this.requestStoreName, retryIds);
    if (this.isOnline()) {
      await this.processQueue();
    }
  }

  async getEventHistory(since?: number): Promise<SyncEventRecord[]> {
    const db = await this.dbPromise;
    return getEventLog(db, this.eventStoreName, since);
  }

  private async handleRequest<T>(
    method: HttpMethod,
    url: string,
    options: HttpRequestOptions,
    observer: Observer<HttpResult<T>>,
  ): Promise<void> {
    const responseType = options.responseType ?? DEFAULT_RESPONSE_TYPE;
    const serializedBody = serializeBody(options.body);
    const headers = new Headers(options.headers ?? {});
    applyDefaultContentType(headers, serializedBody);

    const requestRecord: StoredRequest = {
      id: generateId(),
      method,
      url,
      headers: Array.from(headers.entries()),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: 0,
      maxAttempts: Math.max(1, options.retries ?? this.options.defaultRetries),
      retryDelay: options.retryDelay ?? this.options.defaultRetryDelay,
      retryStrategy: options.retryStrategy ?? 'exponential',
      responseType,
      state: 'pending',
    };

    if (serializedBody) {
      requestRecord.body = serializedBody;
    }
    if (options.metadata) {
      requestRecord.metadata = options.metadata;
    }

    const online = this.isOnline() && !options.queueOnly;
    const db = await this.dbPromise;

    if (!online) {
      await this.enqueueRequest(db, requestRecord, observer);
      return;
    }

    try {
      const fetchInit = buildFetchInit(requestRecord, options.signal);
      const response = await fetch(url, fetchInit);
      if (!response.ok) {
        const error = new Error(`HTTP error ${response.status}`);
        const detail = toErrorDetail(requestRecord, error, false);
        const record = this.events.emit('sync:error', detail);
        await saveEvent(db, this.eventStoreName, record);
        observer.error(error);
        return;
      }
      const data = (await parseResponse<T>(response.clone(), responseType)) as T;
      const result: HttpSuccessResult<T> = {
        status: 'success',
        response,
        data,
      };
      observer.next(result);
      observer.complete();
    } catch (error) {
      requestRecord.lastError = error instanceof Error ? error.message : String(error);
      await this.enqueueRequest(db, requestRecord, observer, error);
    }
  }

  private async enqueueRequest<T>(
    db: OfflineHttpDatabase,
    requestRecord: StoredRequest,
    observer: Observer<HttpResult<T>>,
    error?: unknown,
  ): Promise<void> {
    await saveRequest(db, this.requestStoreName, requestRecord);
    const queueEvent: SyncQueueEventDetail = {
      id: requestRecord.id,
      url: requestRecord.url,
      method: requestRecord.method,
      ...(requestRecord.metadata ? { metadata: requestRecord.metadata } : {}),
    };
    const record = this.events.emit('queue:added', queueEvent);
    await saveEvent(db, this.eventStoreName, record);

    if (error) {
      const detail = toErrorDetail(requestRecord, error, true);
      const errorRecord = this.events.emit('sync:error', detail);
      await saveEvent(db, this.eventStoreName, errorRecord);
    }

    const result: HttpQueuedResult = {
      status: 'queued',
      id: requestRecord.id,
    };
    if (requestRecord.metadata) {
      result.metadata = requestRecord.metadata;
    }
    observer.next(result);
    observer.complete();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const db = await this.dbPromise;
      const pending = await listRequestsByState(db, this.requestStoreName, 'pending');
      pending.sort((a, b) => a.createdAt - b.createdAt);

      for (const request of pending) {
        if (!this.isOnline()) {
          break;
        }
        await this.executeQueuedRequest(db, request);
      }

      const remaining = await listRequestsByState(db, this.requestStoreName, 'pending');
      const drainRecord = this.events.emit('queue:drain', { remaining: remaining.length });
      await saveEvent(db, this.eventStoreName, drainRecord);

      await pruneEvents(db, this.eventStoreName, this.options.queueRetentionMs);
    } finally {
      this.processing = false;
    }
  }

  private async executeQueuedRequest(db: OfflineHttpDatabase, request: StoredRequest): Promise<void> {
    const updated: StoredRequest = { ...request, state: 'processing', attempts: request.attempts + 1, updatedAt: Date.now() };
    await updateRequest(db, this.requestStoreName, updated);

    try {
      const response = await fetch(updated.url, buildFetchInit(updated));
      if (!response.ok) {
        const error = new Error(`HTTP error ${response.status}`);
        await this.handlePermanentFailure(db, updated, error);
        return;
      }

      const data = await parseResponse(response.clone(), updated.responseType);
      const successDetail: SyncSuccessEventDetail = {
        id: updated.id,
        url: updated.url,
        method: updated.method,
        response: {
          status: response.status,
          ok: response.ok,
          headers: Array.from(response.headers.entries()),
          data,
        },
        ...(updated.metadata ? { metadata: updated.metadata } : {}),
      };

      await deleteRequest(db, this.requestStoreName, updated.id);
      const record = this.events.emit('sync:success', successDetail);
      await saveEvent(db, this.eventStoreName, record);
    } catch (error) {
      await this.handleRetryableFailure(db, updated, error);
    }
  }

  private async handleRetryableFailure(
    db: OfflineHttpDatabase,
    request: StoredRequest,
    error: unknown,
  ): Promise<void> {
    const willRetry = request.attempts < request.maxAttempts;
    const detail = toErrorDetail(request, error, willRetry);
    const record = this.events.emit(willRetry ? 'sync:error' : 'sync:failed', detail);
    await saveEvent(db, this.eventStoreName, record);

    if (!willRetry) {
      request.state = 'failed';
      request.lastError = detail.error;
      request.updatedAt = Date.now();
      await updateRequest(db, this.requestStoreName, request);
      return;
    }

    const nextDelay = computeRetryDelay(request);
    const retryDetail: SyncRetryEventDetail = {
      id: request.id,
      url: request.url,
      method: request.method,
      attempt: request.attempts,
      nextRetryInMs: nextDelay,
      ...(request.metadata ? { metadata: request.metadata } : {}),
    };
    const retryRecord = this.events.emit('sync:retry', retryDetail);
    await saveEvent(db, this.eventStoreName, retryRecord);

    request.state = 'pending';
    request.updatedAt = Date.now();
    request.lastError = detail.error;
    await updateRequest(db, this.requestStoreName, request);

    setTimeout(() => {
      if (this.isOnline()) {
        void this.processQueue();
      }
    }, nextDelay);
  }

  private async handlePermanentFailure(db: OfflineHttpDatabase, request: StoredRequest, error: Error): Promise<void> {
    request.state = 'failed';
    request.lastError = error.message;
    request.updatedAt = Date.now();
    await updateRequest(db, this.requestStoreName, request);
    const detail = toErrorDetail(request, error, false);
    const record = this.events.emit('sync:failed', detail);
    await saveEvent(db, this.eventStoreName, record);
  }

  private isOnline(): boolean {
    if (typeof navigator === 'undefined' || typeof navigator.onLine === 'undefined') {
      return true;
    }
    return navigator.onLine;
  }

}

function buildFetchInit(request: StoredRequest, signal?: AbortSignal): RequestInit {
  const headers = new Headers(request.headers);
  applyDefaultContentType(headers, request.body);
  const init: RequestInit = {
    method: request.method,
    headers,
  };
  const body = deserializeBody(request.body);
  if (body !== undefined) {
    init.body = body;
  }
  if (signal) {
    init.signal = signal;
  }
  return init;
}

async function parseResponse<T>(response: Response, responseType: ResponseType): Promise<T> {
  switch (responseType) {
    case 'json':
      return (await response.json()) as T;
    case 'text':
      return (await response.text()) as T;
    case 'blob':
      return (await response.blob()) as T;
    case 'arrayBuffer':
      return (await response.arrayBuffer()) as T;
    case 'response':
    default:
      return response as unknown as T;
  }
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function applyDefaultContentType(headers: Headers, body?: SerializedBody | BodyInit | null): void {
  if (!body) {
    return;
  }

  const headerKeys = Array.from(headers.keys());
  const hasContentType = headerKeys.some((key) => key.toLowerCase() === 'content-type');
  if (hasContentType) {
    return;
  }

  if (isSerializedBody(body)) {
    switch (body.type) {
      case 'json':
        headers.set('Content-Type', 'application/json;charset=UTF-8');
        break;
      case 'text':
        headers.set('Content-Type', 'text/plain;charset=UTF-8');
        break;
      case 'searchParams':
        headers.set('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
        break;
      case 'blob':
        headers.set('Content-Type', body.value.type || 'application/octet-stream');
        break;
      case 'arrayBuffer':
        headers.set('Content-Type', 'application/octet-stream');
        break;
      case 'formData':
        // Let the browser set multipart boundaries automatically.
        break;
      default:
        break;
    }
    return;
  }

  if (typeof body === 'string') {
    headers.set('Content-Type', 'text/plain;charset=UTF-8');
  } else if (body instanceof URLSearchParams) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
  } else if (body instanceof Blob && !(body instanceof FormData)) {
    headers.set('Content-Type', body.type || 'application/octet-stream');
  }
}

function toErrorDetail(request: StoredRequest, error: unknown, willRetry: boolean): SyncErrorEventDetail {
  return {
    id: request.id,
    url: request.url,
    method: request.method,
    attempts: request.attempts,
    error: error instanceof Error ? error.message : String(error),
    willRetry,
    ...(request.metadata ? { metadata: request.metadata } : {}),
  };
}

function computeRetryDelay(request: StoredRequest): number {
  const base = request.retryDelay;
  const attempt = request.attempts;
  switch (request.retryStrategy) {
    case 'fixed':
      return base;
    case 'linear':
      return base * attempt;
    case 'exponential':
    default:
      return base * Math.pow(2, attempt - 1);
  }
}

function isSerializedBody(value: unknown): value is SerializedBody {
  return typeof value === 'object' && value !== null && 'type' in (value as Record<string, unknown>);
}
