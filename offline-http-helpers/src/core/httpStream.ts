import type { HttpStreamEvent } from '../types.js';

export interface HttpObserver<T> {
  next?: (value: T) => void;
  error?: (error: unknown) => void;
  complete?: () => void;
}

export type HttpStreamOperator<I, O> = (input: HttpStream<I>) => HttpStream<O>;

type Executor<T> = (observer: HttpObserver<T>) => void | (() => void) | Promise<void | (() => void)>;

export class HttpStream<T> {
  private readonly executor: Executor<T>;

  constructor(executor: Executor<T>) {
    this.executor = executor;
  }

  subscribe(observer: HttpObserver<T>): { unsubscribe: () => void };
  subscribe(
    next?: ((value: T) => void) | null,
    error?: ((error: unknown) => void) | null,
    complete?: () => void
  ): { unsubscribe: () => void };
  subscribe(
    observerOrNext: HttpObserver<T> | ((value: T) => void) | null = null,
    error?: ((error: unknown) => void) | null,
    complete?: () => void
  ): { unsubscribe: () => void } {
    const observer: HttpObserver<T> =
      typeof observerOrNext === 'function'
        ? { next: observerOrNext ?? undefined, error: error ?? undefined, complete }
        : observerOrNext ?? { next: undefined, error: undefined, complete: undefined };

    let cleanup: void | (() => void) | Promise<void | (() => void)>;
    let closed = false;

    const safeObserver: HttpObserver<T> = {
      next: (value) => {
        if (!closed) {
          observer.next?.(value);
        }
      },
      error: (err) => {
        if (!closed) {
          closed = true;
          observer.error?.(err);
          cleanupIfNeeded(cleanup);
        }
      },
      complete: () => {
        if (!closed) {
          closed = true;
          observer.complete?.();
          cleanupIfNeeded(cleanup);
        }
      },
    };

    try {
      cleanup = this.executor(safeObserver);
    } catch (err) {
      safeObserver.error?.(err);
    }

    return {
      unsubscribe: () => {
        if (!closed) {
          closed = true;
          cleanupIfNeeded(cleanup);
        }
      },
    };
  }

  pipe(...operators: Array<HttpStreamOperator<unknown, unknown>>): HttpStream<unknown> {
    return operators.reduce<HttpStream<unknown>>(
      (stream, operator) => operator(stream),
      this as unknown as HttpStream<unknown>
    );
  }

  map<U>(project: (value: T) => U | Promise<U>): HttpStream<U> {
    return new HttpStream<U>((observer) => {
      const subscription = this.subscribe({
        next: async (value) => {
          try {
            const result = await project(value);
            observer.next?.(result);
          } catch (error) {
            observer.error?.(error);
          }
        },
        error: (error) => observer.error?.(error),
        complete: () => observer.complete?.(),
      });

      return () => subscription.unsubscribe();
    });
  }

  tap(sideEffect: (value: T) => void | Promise<void>): HttpStream<T> {
    return new HttpStream<T>((observer) => {
      const subscription = this.subscribe({
        next: async (value) => {
          try {
            await sideEffect(value);
            observer.next?.(value);
          } catch (error) {
            observer.error?.(error);
          }
        },
        error: (error) => observer.error?.(error),
        complete: () => observer.complete?.(),
      });

      return () => subscription.unsubscribe();
    });
  }

  toPromise(): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let lastValue: T;
      this.subscribe({
        next: (value) => {
          lastValue = value;
        },
        error: reject,
        complete: () => resolve(lastValue),
      });
    });
  }

  static fromEventStream(event: HttpStreamEvent): HttpStream<HttpStreamEvent> {
    return new HttpStream<HttpStreamEvent>((observer) => {
      observer.next?.(event);
      observer.complete?.();
    });
  }
}

const cleanupIfNeeded = (cleanup: void | (() => void) | Promise<void | (() => void)>): void => {
  if (!cleanup) {
    return;
  }

  if (typeof cleanup === 'function') {
    cleanup();
    return;
  }

  Promise.resolve(cleanup).then((result) => {
    if (typeof result === 'function') {
      result();
    }
  });
};
