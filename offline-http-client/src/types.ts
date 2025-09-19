export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'TRACE'
  | 'CONNECT'
  | (string & {});

export type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'response';

export interface HttpRequestOptions<TBody = any> {
  headers?: HeadersInit;
  body?: BodyInit | TBody | null;
  responseType?: ResponseType;
  retries?: number;
  retryDelay?: number;
  retryStrategy?: 'exponential' | 'linear' | 'fixed';
  queueOnly?: boolean;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface HttpQueuedResult {
  status: 'queued';
  id: string;
  metadata?: Record<string, unknown>;
}

export interface HttpSuccessResult<T = unknown> {
  status: 'success';
  response: Response;
  data: T;
}

export type HttpResult<T = unknown> = HttpQueuedResult | HttpSuccessResult<T>;

export interface OfflineHttpClientOptions {
  databaseName?: string;
  storeName?: string;
  eventStoreName?: string;
  defaultRetries?: number;
  defaultRetryDelay?: number;
  autoStart?: boolean;
  queueRetentionMs?: number;
}

export interface SerializedJsonBody {
  type: 'json';
  value: unknown;
}

export interface SerializedTextBody {
  type: 'text';
  value: string;
}

export interface SerializedBlobBody {
  type: 'blob';
  value: Blob;
  fileName?: string;
}

export interface SerializedArrayBufferBody {
  type: 'arrayBuffer';
  value: ArrayBuffer;
}

export interface SerializedFormDataEntryText {
  key: string;
  valueType: 'text';
  value: string;
}

export interface SerializedFormDataEntryBlob {
  key: string;
  valueType: 'blob';
  value: Blob;
  fileName?: string;
}

export interface SerializedFormDataBody {
  type: 'formData';
  entries: Array<SerializedFormDataEntryText | SerializedFormDataEntryBlob>;
}

export interface SerializedUrlSearchParamsBody {
  type: 'searchParams';
  value: string;
}

export type SerializedBody =
  | SerializedJsonBody
  | SerializedTextBody
  | SerializedBlobBody
  | SerializedArrayBufferBody
  | SerializedFormDataBody
  | SerializedUrlSearchParamsBody;

export interface StoredRequest {
  id: string;
  method: HttpMethod;
  url: string;
  headers?: [string, string][];
  body?: SerializedBody;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  maxAttempts: number;
  retryDelay: number;
  retryStrategy: 'exponential' | 'linear' | 'fixed';
  responseType: ResponseType;
  state: 'pending' | 'processing' | 'failed';
  lastError?: string;
}

export interface SyncSuccessEventDetail<T = unknown> {
  id: string;
  url: string;
  method: HttpMethod;
  response: {
    status: number;
    ok: boolean;
    headers: [string, string][];
    data: T;
  };
  metadata?: Record<string, unknown>;
}

export interface SyncErrorEventDetail {
  id: string;
  url: string;
  method: HttpMethod;
  attempts: number;
  error: string;
  willRetry: boolean;
  metadata?: Record<string, unknown>;
}

export interface SyncRetryEventDetail {
  id: string;
  url: string;
  method: HttpMethod;
  attempt: number;
  nextRetryInMs: number;
  metadata?: Record<string, unknown>;
}

export interface SyncQueueEventDetail {
  id: string;
  url: string;
  method: HttpMethod;
  metadata?: Record<string, unknown>;
}

export interface SyncDrainEventDetail {
  remaining: number;
}

export interface SyncEventMap {
  'queue:added': SyncQueueEventDetail;
  'queue:drain': SyncDrainEventDetail;
  'sync:success': SyncSuccessEventDetail;
  'sync:error': SyncErrorEventDetail;
  'sync:retry': SyncRetryEventDetail;
  'sync:failed': SyncErrorEventDetail;
}

export type SyncEventType = keyof SyncEventMap;

export interface SyncEventRecord<T extends SyncEventType = SyncEventType> {
  id: string;
  type: T;
  detail: SyncEventMap[T];
  timestamp: number;
}

export interface OfflineHttpDB extends IDBDatabase {}
