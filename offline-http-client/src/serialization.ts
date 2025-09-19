import type {
  SerializedArrayBufferBody,
  SerializedBlobBody,
  SerializedBody,
  SerializedFormDataBody,
  SerializedFormDataEntryBlob,
  SerializedFormDataEntryText,
  SerializedJsonBody,
  SerializedTextBody,
  SerializedUrlSearchParamsBody,
} from './types.js';

export function serializeBody(body: BodyInit | Record<string, unknown> | null | undefined): SerializedBody | undefined {
  if (body == null) {
    return undefined;
  }

  if (typeof body === 'string') {
    return { type: 'text', value: body } satisfies SerializedTextBody;
  }

  if (body instanceof Blob) {
    const blobBody: SerializedBlobBody = {
      type: 'blob',
      value: body,
    };
    if (typeof (body as File).name === 'string' && (body as File).name) {
      blobBody.fileName = (body as File).name;
    }
    return blobBody;
  }

  if (body instanceof ArrayBuffer) {
    return { type: 'arrayBuffer', value: body } satisfies SerializedArrayBufferBody;
  }

  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    const copy = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
    return { type: 'arrayBuffer', value: copy } satisfies SerializedArrayBufferBody;
  }

  if (body instanceof URLSearchParams) {
    return { type: 'searchParams', value: body.toString() } satisfies SerializedUrlSearchParamsBody;
  }

  if (body instanceof FormData) {
    const entries: Array<SerializedFormDataEntryText | SerializedFormDataEntryBlob> = [];
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') {
        entries.push({ key, valueType: 'text', value });
      } else {
        const entry: SerializedFormDataEntryBlob = {
          key,
          valueType: 'blob',
          value,
        };
        if (value.name) {
          entry.fileName = value.name;
        }
        entries.push(entry);
      }
    }
    return { type: 'formData', entries } satisfies SerializedFormDataBody;
  }

  if (typeof body === 'object') {
    return { type: 'json', value: body } satisfies SerializedJsonBody;
  }

  throw new Error('Unsupported body type for serialization');
}

export function deserializeBody(serialized?: SerializedBody): BodyInit | undefined {
  if (!serialized) {
    return undefined;
  }

  switch (serialized.type) {
    case 'text':
      return serialized.value;
    case 'json':
      return JSON.stringify(serialized.value);
    case 'blob':
      if (serialized.fileName) {
        return recreateFile({
          key: '',
          valueType: 'blob',
          value: serialized.value,
          fileName: serialized.fileName,
        });
      }
      return serialized.value;
    case 'arrayBuffer':
      return serialized.value;
    case 'searchParams':
      return serialized.value;
    case 'formData': {
      const form = new FormData();
      for (const entry of serialized.entries) {
        if (entry.valueType === 'text') {
          form.append(entry.key, entry.value);
        } else {
          form.append(entry.key, recreateFile(entry));
        }
      }
      return form;
    }
    default:
      return undefined;
  }
}

function recreateFile(entry: SerializedFormDataEntryBlob): Blob {
  if (entry.fileName && typeof File !== 'undefined') {
    return new File([entry.value], entry.fileName, { type: entry.value.type });
  }
  return new Blob([entry.value], { type: entry.value.type });
}
