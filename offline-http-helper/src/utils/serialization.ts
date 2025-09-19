import type { SerializedBody } from '../types.js';

const textEnc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const textDec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, type?: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return typeof type === 'string' ? new Blob([bytes], { type }) : new Blob([bytes]);
}

export async function serializeBody(body: any): Promise<SerializedBody> {
  if (body === null || body === undefined) {
    return { type: 'null', payload: null };
  }

  if (typeof body === 'string') {
    return { type: 'text', payload: body };
  }

  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return {
      type: 'blob',
      payload: await blobToBase64(body),
      meta: { mimeType: body.type },
    };
  }

  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const entries: Array<{ key: string; value: SerializedBody }> = [];
    for (const [key, value] of body.entries()) {
      entries.push({ key, value: await serializeBody(value) });
    }
    return {
      type: 'formData',
      payload: JSON.stringify(entries),
    };
  }

  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    const buffer = body instanceof ArrayBuffer ? body : body.buffer;
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return { type: 'arrayBuffer', payload: btoa(binary) };
  }

  return {
    type: 'json',
    payload: JSON.stringify(body),
  };
}

export async function deserializeBody(serialized: SerializedBody): Promise<any> {
  switch (serialized.type) {
    case 'null':
      return null;
    case 'text':
      return serialized.payload;
    case 'json':
      return serialized.payload ? JSON.parse(serialized.payload) : null;
    case 'blob':
      if (!serialized.payload) return null;
      return base64ToBlob(serialized.payload, serialized.meta?.mimeType);
    case 'formData':
      if (typeof FormData === 'undefined') {
        throw new Error('FormData is not available in this environment');
      }
      if (!serialized.payload) return new FormData();
      const parsed = JSON.parse(serialized.payload) as Array<{ key: string; value: SerializedBody }>;
      const formData = new FormData();
      for (const entry of parsed) {
        const value = await deserializeBody(entry.value);
        formData.append(entry.key, value);
      }
      return formData;
    case 'arrayBuffer':
      if (!serialized.payload) return null;
      const binary = atob(serialized.payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    default:
      return serialized.payload;
  }
}

export function headersToObject(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const obj: Record<string, string> = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
  }
  return { ...headers };
}

export function mergeHeaders(base: Record<string, string>, override?: Record<string, string>): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(base).map(([key, value]) => [key.toLowerCase(), value])),
    ...Object.fromEntries(Object.entries(override ?? {}).map(([key, value]) => [key.toLowerCase(), value])),
  };
}
