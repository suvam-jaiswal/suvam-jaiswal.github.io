export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'TRACE';

export type ResponseType =
  | 'json'
  | 'text'
  | 'blob'
  | 'arrayBuffer'
  | 'formData'
  | 'raw';

export interface HttpRequestOptions extends RequestInit {
  /**
   * Automatically queue the request in IndexedDB when the device is offline.
   * @default true
   */
  queueOffline?: boolean;
  /**
   * When a request fails due to a network error during an online session, automatically
   * queue it for later replay.
   * @default true
   */
  queueOnError?: boolean;
  /**
   * Defines how the response should be deserialized before emitting to subscribers.
   * @default 'json'
   */
  responseType?: ResponseType;
  /**
   * Arbitrary metadata stored alongside the request for auditing or display purposes.
   */
  metadata?: Record<string, unknown>;
}

export interface HttpClientConfig {
  /** Optional base URL applied to every request. */
  baseUrl?: string;
  /** Default request options merged with per-request configuration. */
  defaultOptions?: HttpRequestOptions;
  /** IndexedDB configuration for the offline queue. */
  offlineQueue?: OfflineQueueOptions;
  /** Synchronisation behaviour customisation. */
  sync?: SyncManagerOptions;
}

export interface HttpResponse<T = unknown> {
  /** HTTP status code. */
  status: number;
  /** Response headers represented as a plain object. */
  headers: Record<string, string>;
  /** Parsed response body. */
  data: T;
  /** Indicates where the response originated from. */
  source: 'network' | 'replay';
  /** Unique identifier of the originating request when replayed or queued. */
  requestId?: string;
}

export type HttpRequestResult<T = unknown> =
  | { kind: 'response'; response: HttpResponse<T> }
  | { kind: 'queued'; request: QueuedRequestPayload };

export interface QueuedRequestPayload {
  id: string;
  url: string;
  method: HttpMethod;
  requestInit: SerializedRequestInit;
  metadata?: Record<string, unknown>;
  responseType: ResponseType;
  createdAt: number;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: SerializedError | null;
  nextAttemptAt?: number | null;
}

export interface SyncStats {
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

export interface SerializedHeaders {
  entries: Array<[string, string]>;
}

export interface SerializedFormDataValueString {
  kind: 'string';
  value: string;
}

export interface SerializedFormDataValueBlob {
  kind: 'blob';
  value: ArrayBuffer;
  type?: string;
  name?: string;
}

export type SerializedFormDataValue = SerializedFormDataValueString | SerializedFormDataValueBlob;

export interface SerializedFormDataEntry {
  name: string;
  value: SerializedFormDataValue;
}

export type SerializedBody =
  | { kind: 'none' }
  | { kind: 'text'; value: string }
  | { kind: 'json'; value: unknown }
  | { kind: 'blob'; value: ArrayBuffer; type?: string; name?: string }
  | { kind: 'arrayBuffer'; value: ArrayBuffer }
  | { kind: 'formData'; value: SerializedFormDataEntry[] };

export interface SerializedRequestInit {
  headers: SerializedHeaders;
  body: SerializedBody;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  integrity?: string;
  keepalive?: boolean;
  mode?: RequestMode;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  status?: number;
  cause?: unknown;
}

export interface OfflineQueueOptions {
  /**
   * Optional namespace for the IndexedDB database. Allows hosting multiple queues.
   * @default 'offline-http-helper'
   */
  dbName?: string;
  /**
   * Optional version number. Increment to trigger schema upgrades if the structure changes.
   * @default 1
   */
  dbVersion?: number;
}

export interface SyncManagerOptions {
  /**
   * When true the synchronisation stops after the first failure. Otherwise it continues
   * processing the remaining requests.
   * @default false
   */
  haltOnFailure?: boolean;
  /**
   * Maximum retry attempts per request before marking it as failed permanently.
   * @default 5
   */
  maxRetries?: number;
  /**
   * Base delay in milliseconds used for the exponential backoff strategy.
   * @default 1000
   */
  baseRetryDelayMs?: number;
  /**
   * Factor by which the retry delay grows after each failure.
   * @default 2
   */
  backoffMultiplier?: number;
  /**
   * Automatically trigger a replay when the browser fires the `online` event.
   * @default true
   */
  autoReplayOnOnline?: boolean;
}

export interface ReplayResult<T = unknown> {
  request: QueuedRequestPayload;
  response?: HttpResponse<T>;
  error?: SerializedError;
}

export interface SyncProgressEventDetail {
  stats: SyncStats;
  request?: QueuedRequestPayload;
  error?: SerializedError;
  response?: HttpResponse;
}

export interface RequestQueuedEventDetail {
  request: QueuedRequestPayload;
}

export interface RequestErrorEventDetail {
  error: SerializedError;
  request: {
    url: string;
    method: HttpMethod;
    metadata?: Record<string, unknown>;
  };
}

export interface SyncLifecycleEventDetail {
  stats: SyncStats;
}

export interface SyncCompleteEventDetail extends SyncLifecycleEventDetail {
  remainingRequests: QueuedRequestPayload[];
}

export interface ReplayErroredRequestOptions {
  requestId: string;
  /**
   * Optionally override request metadata (e.g. to change headers before retry).
   */
  override?: Partial<{ requestInit: SerializedRequestInit; metadata: Record<string, unknown> }>;
}

