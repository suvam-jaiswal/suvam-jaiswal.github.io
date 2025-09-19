import type { HttpResponse, SerializedError } from './types.js';
export declare class NetworkOfflineError extends Error {
    constructor(message?: string);
}
export declare class HttpStatusError<T = unknown> extends Error {
    readonly response: HttpResponse<T>;
    constructor(response: HttpResponse<T>);
    toSerialized(): SerializedError;
}
export declare class ReplayHttpError<T = unknown> extends HttpStatusError<T> {
    constructor(response: HttpResponse<T>);
}
export declare class NetworkHttpError<T = unknown> extends HttpStatusError<T> {
    constructor(response: HttpResponse<T>);
}
export declare const toSerializedError: (error: unknown, status?: number) => SerializedError;
//# sourceMappingURL=errors.d.ts.map