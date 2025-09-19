import { HttpEventBus } from './events.js';
import { HttpObservable } from './httpObservable.js';
import type { HttpClientConfig, HttpMethod, HttpRequestOptions, HttpRequestResult } from './types.js';
import { OfflineQueue } from './offlineQueue.js';
import { HttpSyncManager } from './syncManager.js';
export declare class HttpClient {
    private readonly queue;
    private readonly events;
    private readonly syncManager;
    private readonly baseUrl?;
    private readonly defaultOptions;
    constructor(config?: HttpClientConfig);
    get eventBus(): HttpEventBus;
    getQueue(): OfflineQueue;
    getSyncManager(): HttpSyncManager;
    request<T = unknown>(method: HttpMethod, url: string, options?: HttpRequestOptions): HttpObservable<HttpRequestResult<T>>;
    get<T = unknown>(url: string, options?: HttpRequestOptions): HttpObservable<HttpRequestResult<T>>;
    delete<T = unknown>(url: string, options?: HttpRequestOptions): HttpObservable<HttpRequestResult<T>>;
    head<T = unknown>(url: string, options?: HttpRequestOptions): HttpObservable<HttpRequestResult<T>>;
    options<T = unknown>(url: string, options?: HttpRequestOptions): HttpObservable<HttpRequestResult<T>>;
    post<T = unknown>(url: string, body?: BodyInit | Record<string, unknown>, options?: HttpRequestOptions): HttpObservable<HttpRequestResult<T>>;
    put<T = unknown>(url: string, body?: BodyInit | Record<string, unknown>, options?: HttpRequestOptions): HttpObservable<HttpRequestResult<T>>;
    patch<T = unknown>(url: string, body?: BodyInit | Record<string, unknown>, options?: HttpRequestOptions): HttpObservable<HttpRequestResult<T>>;
    syncNow(): Promise<void>;
    dispose(): void;
    private mergeOptions;
    private resolveUrl;
    private shouldQueueAfterError;
    private serializeForQueue;
    private queueAndNotify;
    private dispatchRequestError;
    private normalizeBody;
}
//# sourceMappingURL=httpClient.d.ts.map