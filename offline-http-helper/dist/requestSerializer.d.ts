import type { SerializedBody, SerializedError, SerializedHeaders, SerializedRequestInit } from './types.js';
export declare class RequestSerializer {
    static serializeHeaders(headers?: HeadersInit): SerializedHeaders;
    static deserializeHeaders(serialized: SerializedHeaders): Headers;
    static serializeBody(body: unknown): Promise<SerializedBody>;
    static deserializeBody(body: SerializedBody): Promise<BodyInit | undefined>;
    static serializeRequestInit(init?: RequestInit): Promise<SerializedRequestInit>;
    static deserializeRequestInit(serialized: SerializedRequestInit): Promise<RequestInit>;
    static serializeError(error: unknown, status?: number): SerializedError;
}
//# sourceMappingURL=requestSerializer.d.ts.map