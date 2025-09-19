const isDefined = (value) => value !== undefined && value !== null;
export class RequestSerializer {
    static serializeHeaders(headers) {
        const normalized = new Headers(headers ?? {});
        const entries = [];
        normalized.forEach((value, key) => {
            entries.push([key, value]);
        });
        return { entries };
    }
    static deserializeHeaders(serialized) {
        return new Headers(serialized.entries);
    }
    static async serializeBody(body) {
        if (!isDefined(body)) {
            return { kind: 'none' };
        }
        if (typeof body === 'string') {
            return { kind: 'text', value: body };
        }
        if (isBlob(body)) {
            const blobBody = {
                kind: 'blob',
                value: await body.arrayBuffer(),
            };
            if (body.type) {
                blobBody.type = body.type;
            }
            const fileName = getName(body);
            if (fileName) {
                blobBody.name = fileName;
            }
            return blobBody;
        }
        if (body instanceof ArrayBuffer) {
            return { kind: 'arrayBuffer', value: body };
        }
        if (ArrayBuffer.isView(body)) {
            const viewBuffer = body.buffer;
            const cloned = typeof viewBuffer.slice === 'function'
                ? viewBuffer.slice(0)
                : viewBuffer;
            return { kind: 'arrayBuffer', value: cloned };
        }
        if (isURLSearchParams(body)) {
            return { kind: 'text', value: body.toString() };
        }
        if (isFormData(body)) {
            return { kind: 'formData', value: await serializeFormData(body) };
        }
        if (isReadableStream(body)) {
            throw new Error('ReadableStream bodies are not supported for offline persistence.');
        }
        if (typeof body === 'object') {
            return { kind: 'json', value: body };
        }
        return { kind: 'text', value: String(body) };
    }
    static async deserializeBody(body) {
        switch (body.kind) {
            case 'none':
                return undefined;
            case 'text':
                return body.value;
            case 'json':
                return JSON.stringify(body.value);
            case 'blob': {
                const blob = new Blob([body.value], { type: body.type ?? 'application/octet-stream' });
                if (typeof File !== 'undefined' && body.name) {
                    return new File([blob], body.name, { type: blob.type });
                }
                return blob;
            }
            case 'arrayBuffer':
                return body.value;
            case 'formData':
                return deserializeFormData(body.value);
            default: {
                const exhaustiveCheck = body;
                return exhaustiveCheck;
            }
        }
    }
    static async serializeRequestInit(init = {}) {
        return {
            headers: this.serializeHeaders(init.headers),
            body: await this.serializeBody(init.body),
            credentials: init.credentials,
            cache: init.cache,
            integrity: init.integrity,
            keepalive: init.keepalive,
            mode: init.mode,
            redirect: init.redirect,
            referrer: init.referrer,
            referrerPolicy: init.referrerPolicy,
        };
    }
    static async deserializeRequestInit(serialized) {
        const body = await this.deserializeBody(serialized.body);
        return {
            headers: this.deserializeHeaders(serialized.headers),
            body: body ?? null,
            credentials: serialized.credentials,
            cache: serialized.cache,
            integrity: serialized.integrity,
            keepalive: serialized.keepalive,
            mode: serialized.mode,
            redirect: serialized.redirect,
            referrer: serialized.referrer,
            referrerPolicy: serialized.referrerPolicy,
        };
    }
    static serializeError(error, status) {
        if (error instanceof Error) {
            const serialized = {
                name: error.name,
                message: error.message,
            };
            if (error.stack) {
                serialized.stack = error.stack;
            }
            if (status !== undefined) {
                serialized.status = status;
            }
            const cause = error.cause;
            if (cause !== undefined) {
                serialized.cause = cause;
            }
            return serialized;
        }
        const fallback = {
            name: 'UnknownError',
            message: typeof error === 'string' ? error : 'Unknown error',
        };
        if (status !== undefined) {
            fallback.status = status;
        }
        if (error !== undefined) {
            fallback.cause = error;
        }
        return fallback;
    }
}
async function serializeFormData(formData) {
    const entries = [];
    for (const [name, value] of formData.entries()) {
        if (typeof value === 'string') {
            entries.push({ name, value: { kind: 'string', value } });
        }
        else if (isBlob(value)) {
            const buffer = await value.arrayBuffer();
            const blobValue = {
                kind: 'blob',
                value: buffer,
            };
            if (value.type) {
                blobValue.type = value.type;
            }
            const fileName = getName(value);
            if (fileName) {
                blobValue.name = fileName;
            }
            entries.push({
                name,
                value: blobValue,
            });
        }
    }
    return entries;
}
function deserializeFormData(entries) {
    if (typeof FormData === 'undefined') {
        throw new Error('FormData is not supported in the current environment.');
    }
    const formData = new FormData();
    for (const entry of entries) {
        if (entry.value.kind === 'string') {
            formData.append(entry.name, entry.value.value);
        }
        else {
            const blob = new Blob([entry.value.value], {
                type: entry.value.type ?? 'application/octet-stream',
            });
            if (typeof File !== 'undefined' && entry.value.name) {
                const file = new File([blob], entry.value.name, { type: blob.type });
                formData.append(entry.name, file);
            }
            else if (entry.value.name) {
                formData.append(entry.name, blob, entry.value.name);
            }
            else {
                formData.append(entry.name, blob);
            }
        }
    }
    return formData;
}
function isBlob(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
}
function isFormData(value) {
    return typeof FormData !== 'undefined' && value instanceof FormData;
}
function isURLSearchParams(value) {
    return typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams;
}
function isReadableStream(value) {
    return typeof ReadableStream !== 'undefined' && value instanceof ReadableStream;
}
function getName(value) {
    if ('name' in value && typeof value.name === 'string') {
        return value.name;
    }
    return undefined;
}
//# sourceMappingURL=requestSerializer.js.map