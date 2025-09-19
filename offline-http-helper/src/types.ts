export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData';

export interface HttpRequestConfig<TBody = any> {
  id?: string;
  method: HttpMethod;
  url: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  body?: TBody;
  /**
   * How the response should be parsed.
   * Defaults to `json` when possible.
   */
  responseType?: ResponseType;
  /**
   * Optional tag that will be included in events for filtering.
   */
  channel?: string;
  /**
   * Number of retry attempts allowed when syncing offline requests.
   */
  maxRetries?: number;
  /**
   * If true, the request will not be queued when offline and will fail immediately.
   */
  requireOnline?: boolean;
  /**
   * Arbitrary metadata stored with the request for application specific workflows.
   */
  metadata?: Record<string, unknown>;
}

export interface HttpResponse<T = unknown> {
  status: number;
  ok: boolean;
  statusText: string;
  headers: Record<string, string>;
  data: T;
  requestId: string;
  url: string;
  fromCache?: boolean;
}

export interface HttpError extends Error {
  requestId: string;
  status?: number;
  isOffline?: boolean;
  retriable?: boolean;
  cause?: unknown;
}

export interface SerializedBody {
  type: 'json' | 'text' | 'blob' | 'formData' | 'arrayBuffer' | 'null';
  payload: string | null;
  meta?: Record<string, any>;
}

export interface StoredRequest {
  id: string;
  config: HttpRequestConfig;
  body: SerializedBody;
  attempts: number;
  createdAt: number;
  lastError?: string;
}

export interface SyncStats {
  total: number;
  processed: number;
  failed: number;
}

export interface HttpEventMap {
  'request:queued': CustomEvent<{ request: StoredRequest }>;
  'request:success': CustomEvent<{ response: HttpResponse; request: StoredRequest | null }>;
  'request:error': CustomEvent<{ error: HttpError; request: StoredRequest | null }>;
  'request:permanent-failure': CustomEvent<{ error: HttpError; request: StoredRequest }>;
  'sync:started': CustomEvent<{ stats: SyncStats }>;
  'sync:progress': CustomEvent<{ stats: SyncStats; request: StoredRequest }>;
  'sync:completed': CustomEvent<{ stats: SyncStats }>;
  'sync:error': CustomEvent<{ error: HttpError; stats: SyncStats; request: StoredRequest }>;
}

export type HttpEventName = keyof HttpEventMap;

export type EventListenerMap = {
  [K in HttpEventName]?: (event: HttpEventMap[K]) => void;
};

export interface HttpClientOptions {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  /**
   * Maximum number of retries for queued requests before moving them to the dead letter queue.
   */
  maxRetries?: number;
  /**
   * When true, the client will automatically start syncing queued requests upon instantiation.
   */
  autoStart?: boolean;
  /**
   * Time in milliseconds between background sync polls when the browser does not emit online events.
   */
  backgroundSyncInterval?: number;
}
