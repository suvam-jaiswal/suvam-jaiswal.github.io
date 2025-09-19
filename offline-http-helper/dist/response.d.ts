import type { HttpResponse, ResponseType } from './types.js';
export declare function parseResponse<T>(response: Response, responseType: ResponseType, source: 'network' | 'replay', requestId?: string): Promise<HttpResponse<T>>;
//# sourceMappingURL=response.d.ts.map