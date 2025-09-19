import { HttpEventBus, createEventBus } from './events.js';
import { HttpObservable } from './httpObservable.js';
import { OfflineQueue } from './offlineQueue.js';
import { HttpSyncManager } from './syncManager.js';
import { RequestSerializer } from './requestSerializer.js';
import { HttpStatusError, NetworkHttpError, NetworkOfflineError, toSerializedError } from './errors.js';
import { mergeHeaders, isBrowserOnline } from './utils.js';
import { parseResponse } from './response.js';
export class HttpClient {
    constructor(config = {}) {
        this.baseUrl = config.baseUrl ?? undefined;
        const defaults = { ...config.defaultOptions };
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
    get eventBus() {
        return this.events;
    }
    getQueue() {
        return this.queue;
    }
    getSyncManager() {
        return this.syncManager;
    }
    request(method, url, options = {}) {
        const mergedOptions = this.mergeOptions(options);
        const targetUrl = this.resolveUrl(url);
        const { queueOffline = true, queueOnError = true, responseType = 'json', metadata, signal, headers: _headers, body: rawBody, ...rest } = mergedOptions;
        const normalized = this.normalizeBody(rawBody, _headers);
        const fetchInit = { ...rest };
        if (normalized.headers) {
            fetchInit.headers = normalized.headers;
        }
        if (normalized.body !== undefined) {
            fetchInit.body = normalized.body;
        }
        if (signal !== undefined) {
            fetchInit.signal = signal;
        }
        const context = {
            queueOffline,
            queueOnError,
            responseType,
        };
        if (metadata) {
            context.metadata = metadata;
        }
        return new HttpObservable((observer) => {
            const abortController = !signal ? new AbortController() : undefined;
            const fetchSignal = signal ?? abortController?.signal;
            let serializedInit;
            const getSerializedInit = async () => {
                if (!serializedInit) {
                    serializedInit = await this.serializeForQueue(fetchInit);
                }
                return serializedInit;
            };
            const execute = async () => {
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
                    const parsed = await parseResponse(response, context.responseType ?? 'json', 'network');
                    if (!response.ok) {
                        const error = new NetworkHttpError(parsed);
                        this.dispatchRequestError(targetUrl, method, error, context.metadata);
                        observer.error?.(error);
                        return;
                    }
                    observer.next?.({ kind: 'response', response: parsed });
                    observer.complete?.();
                }
                catch (error) {
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
    get(url, options) {
        return this.request('GET', url, options);
    }
    delete(url, options) {
        return this.request('DELETE', url, options);
    }
    head(url, options) {
        return this.request('HEAD', url, options);
    }
    options(url, options) {
        return this.request('OPTIONS', url, options);
    }
    post(url, body, options = {}) {
        const requestOptions = {
            ...options,
            ...(body !== undefined ? { body: body } : {}),
        };
        return this.request('POST', url, requestOptions);
    }
    put(url, body, options = {}) {
        const requestOptions = {
            ...options,
            ...(body !== undefined ? { body: body } : {}),
        };
        return this.request('PUT', url, requestOptions);
    }
    patch(url, body, options = {}) {
        const requestOptions = {
            ...options,
            ...(body !== undefined ? { body: body } : {}),
        };
        return this.request('PATCH', url, requestOptions);
    }
    async syncNow() {
        await this.syncManager.replayPending();
    }
    dispose() {
        this.syncManager.dispose();
    }
    mergeOptions(options) {
        const merged = { ...this.defaultOptions, ...options };
        const mergedHeaders = mergeHeaders(this.defaultOptions.headers, options.headers);
        if (mergedHeaders) {
            merged.headers = mergedHeaders;
        }
        const metadataSources = [this.defaultOptions.metadata, options.metadata].filter(Boolean);
        if (metadataSources.length > 0) {
            merged.metadata = Object.assign({}, ...metadataSources);
        }
        merged.queueOffline = options.queueOffline ?? this.defaultOptions.queueOffline ?? true;
        merged.queueOnError = options.queueOnError ?? this.defaultOptions.queueOnError ?? true;
        merged.responseType = options.responseType ?? this.defaultOptions.responseType ?? 'json';
        return merged;
    }
    resolveUrl(url) {
        if (!this.baseUrl) {
            return url;
        }
        if (/^https?:\/\//i.test(url)) {
            return url;
        }
        try {
            return new URL(url, this.baseUrl).toString();
        }
        catch {
            return `${this.baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
        }
    }
    shouldQueueAfterError(error) {
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
    async serializeForQueue(init) {
        const { signal: _signal, ...serializable } = init;
        return RequestSerializer.serializeRequestInit(serializable);
    }
    async queueAndNotify(url, method, serializedInit, context, observer) {
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
    dispatchRequestError(url, method, error, metadata) {
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
    normalizeBody(body, headers) {
        if (body === undefined) {
            return headers ? { headers } : {};
        }
        if (body === null) {
            const result = { body: null };
            if (headers) {
                result.headers = headers;
            }
            return result;
        }
        if (isSupportedBody(body)) {
            const result = { body };
            if (headers) {
                result.headers = headers;
            }
            return result;
        }
        if (typeof body === 'object') {
            const normalizedHeaders = mergeHeaders(headers, [['Content-Type', 'application/json']]);
            const result = { body: JSON.stringify(body) };
            if (normalizedHeaders) {
                result.headers = normalizedHeaders;
            }
            return result;
        }
        const result = { body: body };
        if (headers) {
            result.headers = headers;
        }
        return result;
    }
}
function isSupportedBody(value) {
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
//# sourceMappingURL=httpClient.js.map