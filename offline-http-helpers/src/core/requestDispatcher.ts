import type { HttpResponseType } from '../types.js';

export type ResponseParser<T = unknown> = (response: Response) => Promise<T>;

export interface DispatchRequestOptions<TResponse = unknown> {
  method: string;
  url: string;
  requestInit: RequestInit;
  body?: BodyInit;
  responseType: HttpResponseType;
  parser?: ResponseParser<TResponse>;
}

export interface DispatchResult<TResponse = unknown> {
  response: Response;
  data: TResponse;
}

export class HttpRequestError<T = unknown> extends Error {
  readonly response: Response;
  readonly data: T;

  constructor(message: string, response: Response, data: T) {
    super(message);
    this.name = 'HttpRequestError';
    this.response = response;
    this.data = data;
  }
}

export class RequestDispatcher {
  async execute<TResponse>({
    method,
    url,
    requestInit,
    body,
    responseType,
    parser,
  }: DispatchRequestOptions<TResponse>): Promise<DispatchResult<TResponse>> {
    const init: RequestInit = {
      ...requestInit,
      method,
    };

    if (body !== undefined) {
      init.body = body;
    }

    const response = await fetch(url, init);
    const clone = response.clone();

    const data = parser ? await parser(clone) : await parseResponse<TResponse>(clone, responseType);

    if (!response.ok) {
      throw new HttpRequestError('Request failed', response, data);
    }

    return { response, data };
  }
}

const parseResponse = async <T>(response: Response, type: HttpResponseType): Promise<T> => {
  switch (type) {
    case 'arrayBuffer':
      return (await response.arrayBuffer()) as unknown as T;
    case 'blob':
      return (await response.blob()) as unknown as T;
    case 'formData':
      return (await response.formData()) as unknown as T;
    case 'json':
      return (await response.json()) as T;
    case 'text':
      return (await response.text()) as unknown as T;
    case 'raw':
    default:
      return response as unknown as T;
  }
};
