import type { DBSchema } from 'idb';

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export type HttpResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData' | 'raw';

export interface HttpRequestConfig<TResponse = unknown> extends Omit<RequestInit, 'body' | 'method'> {
  /** Optional body for the request. */
  body?: BodyInit | null;
  /** Arbitrary metadata persisted alongside queued requests. */
  metadata?: Record<string, unknown>;
  /** Defaults to true. When true, requests are queued if the device is offline. */
  queueWhenOffline?: boolean;
  /**
   * Defaults to true. When true, requests that fail due to network errors while online
   * are queued for later replay.
   */
  queueWhenOnlineFails?: boolean;
  /** Maximum number of retry attempts during background replay. */
  maxRetries?: number;
  /** Custom delay strategy in milliseconds. */
  retryDelays?: number[];
  /**
   * Determines how the helper resolves the response body. Defaults to `json`.
   */
  responseType?: HttpResponseType;
  /** Custom parser if the consumer needs full control. */
  parseResponse?: (response: Response) => Promise<TResponse>;
  /** Identifier of a parser registered on the client. */
  responseParserKey?: string;
  /**
   * Optional override for the generated request id. Useful when the caller wants to de-duplicate.
   */
  requestId?: string;
  /** Prioritise requests during replay. Defaults to `normal`. */
  queuePriority?: 'high' | 'normal' | 'low';
}

export type HttpStreamEvent<TData = unknown> =
  | {
      type: 'scheduled';
      requestId: string;
      offline: boolean;
      queuedAt: number;
      metadata?: Record<string, unknown>;
    }
  | {
      type: 'response';
      requestId: string;
      response: Response;
      data: TData;
    }
  | {
      type: 'error';
      requestId: string;
      error: unknown;
      attempt: number;
      retriable: boolean;
    }
  | {
      type: 'retry';
      requestId: string;
      attempt: number;
      nextAttemptAt: number;
      delay: number;
    };

export type OfflineRequestStatus = 'pending' | 'in-flight' | 'failed';

export interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
  status?: number;
  statusText?: string;
  retriable?: boolean;
}

export interface SerializedHeaders {
  entries: Array<[string, string]>;
}

export type SerializedBody =
  | { type: 'json'; data: unknown }
  | { type: 'text'; data: string }
  | { type: 'blob'; data: Blob; mimeType: string }
  | { type: 'arrayBuffer'; data: ArrayBuffer }
  | { type: 'formData'; data: SerializedFormDataEntry[] }
  | { type: 'urlSearchParams'; data: string };

export type SerializedFormDataEntry =
  | {
      name: string;
      valueType: 'string';
      value: string;
    }
  | {
      name: string;
      valueType: 'blob';
      value: {
        blob: Blob;
        filename?: string;
        lastModified?: number;
        mimeType?: string;
      };
    };

export interface SerializedRequestInit extends Omit<RequestInit, 'body' | 'headers' | 'signal'> {
  headers: SerializedHeaders;
}

export interface StoredRequest {
  id: string;
  method: HttpMethod;
  url: string;
  requestInit: SerializedRequestInit;
  body?: SerializedBody;
  metadata?: Record<string, unknown>;
  responseType: HttpResponseType;
  responseParserKey?: string;
  createdAt: number;
  updatedAt: number;
  retries: number;
  maxRetries?: number;
  retryDelays?: number[];
  priority: 'high' | 'normal' | 'low';
  priorityIndex: number;
  status: OfflineRequestStatus;
  lastError?: SerializedError;
}

export interface OfflineDbSchema extends DBSchema {
  requests: {
    key: string;
    value: StoredRequest;
    indexes: {
      by_status_priority: [OfflineRequestStatus, number];
    };
  };
}

export interface SyncAttemptResult<TData = unknown> {
  request: StoredRequest;
  success: boolean;
  data?: TData;
  responseSummary?: ResponseSummary;
  error?: SerializedError;
  attempt: number;
  willRetry: boolean;
}

export interface ResponseSummary {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  url: string;
}

export interface HttpEventHubEventMap {
  'request:queued': { request: StoredRequest };
  'request:requeued': { request: StoredRequest };
  'request:sync-started': { request: StoredRequest; attempt: number };
  'request:sync-success': { request: StoredRequest; response: ResponseSummary; data: unknown };
  'request:sync-error': {
    request: StoredRequest;
    error: SerializedError;
    attempt: number;
    willRetry: boolean;
  };
  'request:failed': { request: StoredRequest; error: SerializedError };
  'sync:drain-started': { pending: number };
  'sync:drain-complete': { pending: number };
}

export interface QueueMetrics {
  pending: number;
  failed: number;
  lastSyncAt?: number;
}
