export const generateRequestId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};
export const isBrowserOnline = () => {
    if (typeof navigator === 'undefined') {
        return true;
    }
    if ('onLine' in navigator) {
        return navigator.onLine;
    }
    return true;
};
export const headersToObject = (headers) => {
    const result = {};
    headers.forEach((value, key) => {
        result[key] = value;
    });
    return result;
};
export const mergeHeaders = (base, override) => {
    if (!base && !override) {
        return undefined;
    }
    const merged = new Headers(base ?? {});
    if (override) {
        new Headers(override).forEach((value, key) => merged.set(key, value));
    }
    return merged;
};
export const delay = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
export const now = () => Date.now();
export const hasIndexedDbSupport = () => typeof indexedDB !== 'undefined';
//# sourceMappingURL=utils.js.map