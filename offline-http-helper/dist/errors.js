import { RequestSerializer } from './requestSerializer.js';
export class NetworkOfflineError extends Error {
    constructor(message = 'Network is offline. Request has been queued for later replay.') {
        super(message);
        this.name = 'NetworkOfflineError';
    }
}
export class HttpStatusError extends Error {
    constructor(response) {
        super(`Request failed with status ${response.status}`);
        this.response = response;
        this.name = 'HttpStatusError';
    }
    toSerialized() {
        const serialized = {
            name: this.name,
            message: this.message,
            status: this.response.status,
        };
        if (this.stack) {
            serialized.stack = this.stack;
        }
        if (this.response.data !== undefined) {
            serialized.cause = this.response.data;
        }
        return serialized;
    }
}
export class ReplayHttpError extends HttpStatusError {
    constructor(response) {
        super(response);
        this.name = 'ReplayHttpError';
    }
}
export class NetworkHttpError extends HttpStatusError {
    constructor(response) {
        super(response);
        this.name = 'NetworkHttpError';
    }
}
export const toSerializedError = (error, status) => {
    if (error instanceof HttpStatusError) {
        return error.toSerialized();
    }
    return RequestSerializer.serializeError(error, status);
};
//# sourceMappingURL=errors.js.map