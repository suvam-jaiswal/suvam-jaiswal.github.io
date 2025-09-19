import type { HttpResponse, SerializedError } from './types.js';
import { RequestSerializer } from './requestSerializer.js';

export class NetworkOfflineError extends Error {
  constructor(message = 'Network is offline. Request has been queued for later replay.') {
    super(message);
    this.name = 'NetworkOfflineError';
  }
}

export class HttpStatusError<T = unknown> extends Error {
  constructor(public readonly response: HttpResponse<T>) {
    super(`Request failed with status ${response.status}`);
    this.name = 'HttpStatusError';
  }

  toSerialized(): SerializedError {
    const serialized: SerializedError = {
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

export class ReplayHttpError<T = unknown> extends HttpStatusError<T> {
  constructor(response: HttpResponse<T>) {
    super(response);
    this.name = 'ReplayHttpError';
  }
}

export class NetworkHttpError<T = unknown> extends HttpStatusError<T> {
  constructor(response: HttpResponse<T>) {
    super(response);
    this.name = 'NetworkHttpError';
  }
}

export const toSerializedError = (error: unknown, status?: number): SerializedError => {
  if (error instanceof HttpStatusError) {
    return error.toSerialized();
  }
  return RequestSerializer.serializeError(error, status);
};

