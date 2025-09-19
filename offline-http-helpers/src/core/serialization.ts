import {
  type ResponseSummary,
  type SerializedBody,
  type SerializedError,
  type SerializedFormDataEntry,
  type SerializedHeaders,
  type SerializedRequestInit,
} from '../types.js';

const plainObjectTag = '[object Object]';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === plainObjectTag;

export const serializeHeaders = (headers?: HeadersInit): SerializedHeaders => {
  if (!headers) {
    return { entries: [] };
  }

  const headerEntries: Array<[string, string]> = [];
  const normalized = new Headers(headers);
  normalized.forEach((value, key) => {
    headerEntries.push([key, value]);
  });

  return { entries: headerEntries };
};

export const deserializeHeaders = (headers: SerializedHeaders): HeadersInit => {
  return headers.entries;
};

export const serializeBody = async (body?: BodyInit | null): Promise<SerializedBody | undefined> => {
  if (body == null) {
    return undefined;
  }

  if (typeof body === 'string') {
    return { type: 'text', data: body };
  }

  if (body instanceof Blob) {
    return { type: 'blob', data: body, mimeType: body.type };
  }

  if (body instanceof ArrayBuffer) {
    return { type: 'arrayBuffer', data: body };
  }

  if (ArrayBuffer.isView(body)) {
    return { type: 'arrayBuffer', data: body.buffer.slice(0) };
  }

  if (body instanceof URLSearchParams) {
    return { type: 'urlSearchParams', data: body.toString() };
  }

  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const entries: SerializedFormDataEntry[] = [];
    body.forEach((value, key) => {
      if (typeof value === 'string') {
        entries.push({ name: key, valueType: 'string', value });
        return;
      }

      const blob = value as File | Blob;
      entries.push({
        name: key,
        valueType: 'blob',
        value: {
          blob,
          filename: 'name' in blob ? blob.name : undefined,
          lastModified: 'lastModified' in blob ? blob.lastModified : undefined,
          mimeType: blob.type,
        },
      });
    });
    return { type: 'formData', data: entries };
  }

  if (isPlainObject(body)) {
    return { type: 'json', data: body };
  }

  throw new Error('Unsupported body type for serialization');
};

export const deserializeBody = (body?: SerializedBody): BodyInit | undefined => {
  if (!body) {
    return undefined;
  }

  switch (body.type) {
    case 'text':
      return body.data;
    case 'json':
      return JSON.stringify(body.data);
    case 'blob':
      return new Blob([body.data], { type: body.mimeType });
    case 'arrayBuffer':
      return body.data;
    case 'urlSearchParams':
      return new URLSearchParams(body.data);
    case 'formData': {
      const form = new FormData();
      for (const entry of body.data) {
        if (entry.valueType === 'string') {
          form.append(entry.name, entry.value);
        } else {
          const { blob, filename, lastModified, mimeType } = entry.value;
          const fileName = filename ?? 'file';
          const fileLike =
            typeof File === 'function'
              ? new File([blob], fileName, {
                  type: mimeType ?? blob.type,
                  lastModified: lastModified ?? Date.now(),
                })
              : blob;
          form.append(entry.name, fileLike, fileName);
        }
      }
      return form;
    }
    default:
      return undefined;
  }
};

export const serializeRequestInit = (init: RequestInit, headers: SerializedHeaders): SerializedRequestInit => {
  return {
    cache: init.cache,
    credentials: init.credentials,
    headers,
    integrity: init.integrity,
    keepalive: init.keepalive,
    method: init.method,
    mode: init.mode,
    redirect: init.redirect,
    referrer: init.referrer,
    referrerPolicy: init.referrerPolicy,
    window: init.window,
  };
};

export const deserializeRequestInit = (init: SerializedRequestInit): RequestInit => {
  return {
    cache: init.cache,
    credentials: init.credentials,
    headers: deserializeHeaders(init.headers),
    integrity: init.integrity,
    keepalive: init.keepalive,
    method: init.method,
    mode: init.mode,
    redirect: init.redirect,
    referrer: init.referrer ?? undefined,
    referrerPolicy: init.referrerPolicy,
  };
};

export const serializeError = (error: unknown): SerializedError => {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: Response }).response;
    if (response) {
      return {
        name: error instanceof Error ? error.name : 'HTTPError',
        message: error instanceof Error ? error.message : `${response.status} ${response.statusText}`,
        status: response.status,
        statusText: response.statusText,
      };
    }
  }

  if (error instanceof Response) {
    return {
      name: 'HTTPError',
      message: `${error.status} ${error.statusText}`,
      status: error.status,
      statusText: error.statusText,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: typeof error === 'string' ? error : 'Unknown error',
  };
};

export const summarizeResponse = (response: Response): ResponseSummary => {
  const headers: Array<[string, string]> = [];
  response.headers.forEach((value, key) => {
    headers.push([key, value]);
  });

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    url: response.url,
  };
};
