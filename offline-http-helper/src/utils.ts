export const generateRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const isBrowserOnline = (): boolean => {
  if (typeof navigator === 'undefined') {
    return true;
  }
  if ('onLine' in navigator) {
    return navigator.onLine;
  }
  return true;
};

export const headersToObject = (headers: Headers): Record<string, string> => {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
};

export const mergeHeaders = (base?: HeadersInit, override?: HeadersInit): HeadersInit | undefined => {
  if (!base && !override) {
    return undefined;
  }
  const merged = new Headers(base ?? {});
  if (override) {
    new Headers(override).forEach((value, key) => merged.set(key, value));
  }
  return merged;
};

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const now = (): number => Date.now();

export const hasIndexedDbSupport = (): boolean => typeof indexedDB !== 'undefined';

