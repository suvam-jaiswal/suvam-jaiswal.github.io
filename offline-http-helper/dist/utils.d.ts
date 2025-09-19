export declare const generateRequestId: () => string;
export declare const isBrowserOnline: () => boolean;
export declare const headersToObject: (headers: Headers) => Record<string, string>;
export declare const mergeHeaders: (base?: HeadersInit, override?: HeadersInit) => HeadersInit | undefined;
export declare const delay: (ms: number) => Promise<void>;
export declare const now: () => number;
export declare const hasIndexedDbSupport: () => boolean;
//# sourceMappingURL=utils.d.ts.map